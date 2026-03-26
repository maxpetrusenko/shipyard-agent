/**
 * Commit changes, push branch, and open/update a GitHub PR via gh CLI.
 */

import { WORK_DIR } from '../config/work-dir.js';
import { isAbsolute, relative } from 'node:path';
import type { BashParams, BashResult } from './bash.js';
import { runBash } from './bash.js';

export interface CommitAndOpenPrParams {
  title: string;
  body: string;
  commit_message?: string;
  branch_name?: string;
  base_branch?: string;
  file_paths?: string[];
  draft?: boolean;
  cwd?: string;
}

export interface CommitAndOpenPrResult {
  success: boolean;
  outcome: 'success' | 'partial' | 'failed';
  execution_scope: 'local_only' | 'local_and_remote';
  error: string | null;
  message?: string;
  pr_url: string | null;
  branch: string | null;
  commit_sha: string | null;
  pr_existing: boolean;
  action_receipts: Array<{
    action: string;
    outcome: 'completed' | 'partial' | 'failed' | 'skipped';
    scope: 'local_only' | 'remote_github';
    details: string;
  }>;
}

export type ShellRunner = (params: BashParams) => Promise<BashResult>;

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function run(
  runner: ShellRunner,
  command: string,
  cwd: string,
  timeout = 120_000,
): Promise<BashResult> {
  return runner({ command, cwd, timeout });
}

function fail(
  error: string,
  action_receipts: CommitAndOpenPrResult['action_receipts'] = [],
): CommitAndOpenPrResult {
  return {
    success: false,
    outcome: 'failed',
    execution_scope: 'local_only',
    error,
    pr_url: null,
    branch: null,
    commit_sha: null,
    pr_existing: false,
    action_receipts,
  };
}

function compact(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function normalizeScopedPaths(
  cwd: string,
  filePaths: string[] | undefined,
): { paths: string[]; error: string | null } {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { paths: [], error: null };
  }

  const out = new Set<string>();
  for (const raw of filePaths) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isAbsolute(trimmed)) {
      if (!trimmed.startsWith(cwd + '/') && trimmed !== cwd) {
        return { paths: [], error: `Scoped path outside repo: ${trimmed}` };
      }
      const rel = relative(cwd, trimmed);
      if (!rel || rel.startsWith('..')) {
        return { paths: [], error: `Scoped path outside repo: ${trimmed}` };
      }
      out.add(rel);
      continue;
    }
    if (trimmed.startsWith('../')) {
      return { paths: [], error: `Scoped path outside repo: ${trimmed}` };
    }
    out.add(trimmed);
  }
  return { paths: [...out], error: null };
}

export async function commitAndOpenPr(
  params: CommitAndOpenPrParams,
  runner: ShellRunner = runBash,
): Promise<CommitAndOpenPrResult> {
  const cwd = params.cwd ?? WORK_DIR;
  const receipts: CommitAndOpenPrResult['action_receipts'] = [];
  const pushSucceeded = { value: false };
  const prTouchedRemote = { value: false };
  const scoped = normalizeScopedPaths(cwd, params.file_paths);
  if (scoped.error) {
    receipts.push({
      action: 'validate_scope',
      outcome: 'failed',
      scope: 'local_only',
      details: scoped.error,
    });
    return fail(scoped.error, receipts);
  }

  const gh = await run(runner, 'gh --version', cwd);
  if (!gh.success) {
    receipts.push({
      action: 'check_gh_cli',
      outcome: 'failed',
      scope: 'local_only',
      details: 'gh --version failed',
    });
    return fail('GitHub CLI (gh) not found', receipts);
  }
  receipts.push({
    action: 'check_gh_cli',
    outcome: 'completed',
    scope: 'local_only',
    details: 'gh available',
  });

  const auth = await run(runner, 'gh auth status', cwd);
  if (!auth.success) {
    receipts.push({
      action: 'check_gh_auth',
      outcome: 'failed',
      scope: 'local_only',
      details: 'gh auth status failed',
    });
    return fail('gh auth not configured', receipts);
  }
  receipts.push({
    action: 'check_gh_auth',
    outcome: 'completed',
    scope: 'local_only',
    details: 'gh auth configured',
  });

  const inRepo = await run(runner, 'git rev-parse --is-inside-work-tree', cwd);
  if (!inRepo.success || inRepo.stdout.trim() !== 'true') {
    receipts.push({
      action: 'check_git_repo',
      outcome: 'failed',
      scope: 'local_only',
      details: `not a git repository: ${cwd}`,
    });
    return fail(`Not a git repository: ${cwd}`, receipts);
  }
  receipts.push({
    action: 'check_git_repo',
    outcome: 'completed',
    scope: 'local_only',
    details: `repo ok: ${cwd}`,
  });

  const statusCommand = scoped.paths.length > 0
    ? `git status --porcelain -- ${scoped.paths.map(shQuote).join(' ')}`
    : 'git status --porcelain';
  const status = await run(runner, statusCommand, cwd);
  if (!status.success) {
    receipts.push({
      action: 'check_worktree_changes',
      outcome: 'failed',
      scope: 'local_only',
      details: 'git status failed',
    });
    return fail(compact(status.stderr || status.message || 'git status failed'), receipts);
  }
  if (!status.stdout.trim()) {
    receipts.push({
      action: 'check_worktree_changes',
      outcome: 'failed',
      scope: 'local_only',
      details: 'no staged or unstaged changes detected',
    });
    return fail('No changes detected', receipts);
  }
  receipts.push({
    action: 'check_worktree_changes',
    outcome: 'completed',
    scope: 'local_only',
    details: scoped.paths.length > 0
      ? `detected changes in scoped paths (${scoped.paths.length})`
      : 'detected file changes',
  });

  const currentBranchRes = await run(
    runner,
    'git rev-parse --abbrev-ref HEAD',
    cwd,
  );
  if (!currentBranchRes.success) {
    receipts.push({
      action: 'resolve_branch',
      outcome: 'failed',
      scope: 'local_only',
      details: 'failed to read current branch',
    });
    return fail(compact(currentBranchRes.stderr || currentBranchRes.message || 'Failed to read current branch'), receipts);
  }

  const currentBranch = currentBranchRes.stdout.trim();
  const branch =
    params.branch_name?.trim() ||
    (currentBranch && currentBranch !== 'HEAD'
      ? currentBranch
      : `shipyard/${Date.now()}`);

  if (currentBranch !== branch) {
    const hasBranch = await run(
      runner,
      `git show-ref --verify --quiet refs/heads/${shQuote(branch)}`,
      cwd,
    );
    const checkout = await run(
      runner,
      hasBranch.success
        ? `git checkout ${shQuote(branch)}`
        : `git checkout -b ${shQuote(branch)}`,
      cwd,
    );
    if (!checkout.success) {
      receipts.push({
        action: 'checkout_or_create_branch',
        outcome: 'failed',
        scope: 'local_only',
        details: `failed to checkout branch ${branch}`,
      });
      return fail(compact(checkout.stderr || checkout.message || `Failed to checkout ${branch}`), receipts);
    }
    receipts.push({
      action: 'checkout_or_create_branch',
      outcome: 'completed',
      scope: 'local_only',
      details: `checked out ${branch}`,
    });
  } else {
    receipts.push({
      action: 'checkout_or_create_branch',
      outcome: 'skipped',
      scope: 'local_only',
      details: `already on branch ${branch}`,
    });
  }

  const addCommand = scoped.paths.length > 0
    ? `git add -- ${scoped.paths.map(shQuote).join(' ')}`
    : 'git add -A';
  const add = await run(runner, addCommand, cwd);
  if (!add.success) {
    receipts.push({
      action: 'git_add',
      outcome: 'failed',
      scope: 'local_only',
      details: 'git add -A failed',
    });
    return fail(compact(add.stderr || add.message || 'git add failed'), receipts);
  }
  receipts.push({
    action: 'git_add',
    outcome: 'completed',
    scope: 'local_only',
    details: 'staged changes',
  });

  const staged = await run(runner, 'git diff --cached --name-only', cwd);
  if (!staged.success) {
    receipts.push({
      action: 'check_staged_changes',
      outcome: 'failed',
      scope: 'local_only',
      details: 'failed to inspect staged changes',
    });
    return fail(compact(staged.stderr || staged.message || 'failed to inspect staged changes'), receipts);
  }
  if (!staged.stdout.trim()) {
    receipts.push({
      action: 'check_staged_changes',
      outcome: 'failed',
      scope: 'local_only',
      details: 'no staged changes detected',
    });
    return fail('No scoped changes detected', receipts);
  }
  receipts.push({
    action: 'check_staged_changes',
    outcome: 'completed',
    scope: 'local_only',
    details: 'staged changes ready to commit',
  });

  const commitMessage = (params.commit_message?.trim() || params.title).trim();
  const commit = await run(
    runner,
    `git commit -m ${shQuote(commitMessage)}`,
    cwd,
  );
  if (!commit.success) {
    const out = `${commit.stdout}\n${commit.stderr}`.toLowerCase();
    if (!out.includes('nothing to commit')) {
      receipts.push({
        action: 'git_commit',
        outcome: 'failed',
        scope: 'local_only',
        details: 'git commit failed',
      });
      return fail(compact(commit.stderr || commit.message || 'git commit failed'), receipts);
    }
    receipts.push({
      action: 'git_commit',
      outcome: 'skipped',
      scope: 'local_only',
      details: 'nothing to commit',
    });
  } else {
    receipts.push({
      action: 'git_commit',
      outcome: 'completed',
      scope: 'local_only',
      details: 'created local commit',
    });
  }

  const push = await run(
    runner,
    `git push --set-upstream origin ${shQuote(branch)}`,
    cwd,
  );
  if (!push.success) {
    receipts.push({
      action: 'git_push_origin',
      outcome: 'failed',
      scope: 'remote_github',
      details: `failed to push branch ${branch} to origin`,
    });
    return fail(compact(push.stderr || push.message || 'git push failed'), receipts);
  }
  pushSucceeded.value = true;
  receipts.push({
    action: 'git_push_origin',
    outcome: 'completed',
    scope: 'remote_github',
    details: `pushed branch ${branch} to origin`,
  });

  let baseBranch = params.base_branch?.trim();
  if (!baseBranch) {
    const base = await run(
      runner,
      'gh repo view --json defaultBranchRef --jq .defaultBranchRef.name',
      cwd,
    );
    if (!base.success) {
      receipts.push({
        action: 'resolve_base_branch',
        outcome: 'failed',
        scope: 'remote_github',
        details: 'failed to resolve default branch from GitHub',
      });
      return fail(compact(base.stderr || base.message || 'Failed to resolve default branch'), receipts);
    }
    baseBranch = base.stdout.trim();
  }
  receipts.push({
    action: 'resolve_base_branch',
    outcome: 'completed',
    scope: 'remote_github',
    details: `base branch=${baseBranch}`,
  });

  const existingPr = await run(
    runner,
    `gh pr view --head ${shQuote(branch)} --json url --jq .url`,
    cwd,
  );

  let prUrl = '';
  let prExisting = false;
  if (existingPr.success && existingPr.stdout.trim()) {
    prUrl = existingPr.stdout.trim();
    prExisting = true;
    prTouchedRemote.value = true;
    receipts.push({
      action: 'ensure_pull_request',
      outcome: 'completed',
      scope: 'remote_github',
      details: `reused existing PR: ${prUrl}`,
    });
  } else {
    const draftFlag = params.draft === false ? '' : '--draft';
    const create = await run(
      runner,
      [
        'gh pr create',
        draftFlag,
        `--head ${shQuote(branch)}`,
        `--base ${shQuote(baseBranch)}`,
        `--title ${shQuote(params.title.trim())}`,
        `--body ${shQuote(params.body.trim())}`,
      ]
        .filter(Boolean)
        .join(' '),
      cwd,
    );
    if (!create.success) {
      receipts.push({
        action: 'ensure_pull_request',
        outcome: 'failed',
        scope: 'remote_github',
        details: 'failed to create PR',
      });
      return fail(compact(create.stderr || create.message || 'gh pr create failed'), receipts);
    }
    prUrl = create.stdout.trim();
    prTouchedRemote.value = true;
    receipts.push({
      action: 'ensure_pull_request',
      outcome: 'completed',
      scope: 'remote_github',
      details: `created PR: ${prUrl}`,
    });
  }

  const sha = await run(runner, 'git rev-parse HEAD', cwd);
  const commitSha = sha.success ? sha.stdout.trim() : null;

  return {
    success: true,
    outcome: 'success',
    execution_scope:
      pushSucceeded.value || prTouchedRemote.value ? 'local_and_remote' : 'local_only',
    error: null,
    message: prExisting ? 'Updated existing PR' : 'Created draft PR',
    pr_url: prUrl || null,
    branch,
    commit_sha: commitSha,
    pr_existing: prExisting,
    action_receipts: receipts,
  };
}

export function hasSuccessfulPrToolCall(
  toolCallHistory: Array<{ tool_name: string; tool_result: string }>,
): boolean {
  for (const call of toolCallHistory) {
    if (call.tool_name !== 'commit_and_open_pr') continue;
    try {
      const parsed = JSON.parse(call.tool_result) as { success?: boolean; pr_url?: string | null };
      if (parsed.success && parsed.pr_url) return true;
    } catch {
      // Ignore malformed snapshots
    }
  }
  return false;
}
