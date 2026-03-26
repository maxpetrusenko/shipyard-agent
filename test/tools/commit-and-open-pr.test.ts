import { describe, it, expect } from 'vitest';
import {
  commitAndOpenPr,
  hasSuccessfulPrToolCall,
  type ShellRunner,
} from '../../src/tools/commit-and-open-pr.js';

function makeRunner(
  table: Array<{
    match: RegExp;
    success?: boolean;
    stdout?: string;
    stderr?: string;
    message?: string;
    exit_code?: number;
  }>,
): ShellRunner {
  return async ({ command }) => {
    const entry = table.find((item) => item.match.test(command));
    if (!entry) {
      return {
        success: true,
        exit_code: 0,
        stdout: '',
        stderr: '',
      };
    }
    return {
      success: entry.success ?? true,
      exit_code: entry.exit_code ?? (entry.success === false ? 1 : 0),
      stdout: entry.stdout ?? '',
      stderr: entry.stderr ?? '',
      message: entry.message,
    };
  };
}

describe('commitAndOpenPr', () => {
  it('creates a draft PR for changed files', async () => {
    const runner = makeRunner([
      { match: /^gh --version$/, stdout: 'gh version 2.70.0' },
      { match: /^gh auth status$/, stdout: 'Logged in' },
      { match: /^git rev-parse --is-inside-work-tree$/, stdout: 'true' },
      { match: /^git status --porcelain -- /, stdout: ' M src/a.ts\n' },
      { match: /^git rev-parse --abbrev-ref HEAD$/, stdout: 'feature/test\n' },
      { match: /^git diff --cached --name-only$/, stdout: 'src/a.ts\n' },
      { match: /^git commit -m /, stdout: '[feature/test abc] msg' },
      { match: /^git push --set-upstream origin /, stdout: 'pushed' },
      {
        match: /^gh repo view --json defaultBranchRef --jq \.defaultBranchRef\.name$/,
        stdout: 'main',
      },
      { match: /^gh pr view --head /, success: false, stderr: 'no pull requests found' },
      { match: /^gh pr create /, stdout: 'https://github.com/o/r/pull/123\n' },
      { match: /^git rev-parse HEAD$/, stdout: 'abc123\n' },
    ]);

    const result = await commitAndOpenPr(
      {
        title: 'feat: add thing',
        body: '## Description\nx\n\n## Test Plan\n- [ ] y',
        file_paths: ['src/a.ts'],
      },
      runner,
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.execution_scope).toBe('local_and_remote');
    expect(result.pr_url).toBe('https://github.com/o/r/pull/123');
    expect(result.pr_existing).toBe(false);
    expect(result.branch).toBe('feature/test');
    expect(result.commit_sha).toBe('abc123');
    expect(result.action_receipts.some((r) => r.action === 'git_push_origin' && r.outcome === 'completed')).toBe(true);
    expect(result.action_receipts.some((r) => r.action === 'ensure_pull_request' && r.outcome === 'completed')).toBe(true);
  });

  it('fails when no changes are present', async () => {
    const runner = makeRunner([
      { match: /^gh --version$/, stdout: 'gh version 2.70.0' },
      { match: /^gh auth status$/, stdout: 'Logged in' },
      { match: /^git rev-parse --is-inside-work-tree$/, stdout: 'true' },
      { match: /^git status --porcelain -- /, stdout: '' },
    ]);
    const result = await commitAndOpenPr(
      { title: 'feat: no-op', body: 'body', file_paths: ['src/a.ts'] },
      runner,
    );
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('failed');
    expect(result.execution_scope).toBe('local_only');
    expect(result.error).toContain('No changes detected');
    expect(result.action_receipts.some((r) => r.action === 'check_worktree_changes')).toBe(true);
  });

  it('stages only scoped paths when provided', async () => {
    const commands: string[] = [];
    const runner: ShellRunner = async ({ command }) => {
      commands.push(command);
      if (command === 'gh --version') return { success: true, exit_code: 0, stdout: 'gh version 2.70.0', stderr: '' };
      if (command === 'gh auth status') return { success: true, exit_code: 0, stdout: 'Logged in', stderr: '' };
      if (command === 'git rev-parse --is-inside-work-tree') return { success: true, exit_code: 0, stdout: 'true', stderr: '' };
      if (command.startsWith('git status --porcelain -- ')) return { success: true, exit_code: 0, stdout: ' M src/a.ts\n', stderr: '' };
      if (command === 'git rev-parse --abbrev-ref HEAD') return { success: true, exit_code: 0, stdout: 'feature/test\n', stderr: '' };
      if (command.startsWith('git add -- ')) return { success: true, exit_code: 0, stdout: '', stderr: '' };
      if (command === 'git diff --cached --name-only') return { success: true, exit_code: 0, stdout: 'src/a.ts\n', stderr: '' };
      if (command.startsWith('git commit -m ')) return { success: true, exit_code: 0, stdout: '[feature/test abc] msg', stderr: '' };
      if (command.startsWith('git push --set-upstream origin ')) return { success: true, exit_code: 0, stdout: 'pushed', stderr: '' };
      if (command === 'gh repo view --json defaultBranchRef --jq .defaultBranchRef.name') return { success: true, exit_code: 0, stdout: 'main\n', stderr: '' };
      if (command.startsWith('gh pr view --head ')) return { success: false, exit_code: 1, stdout: '', stderr: 'no pull requests found' };
      if (command.startsWith('gh pr create ')) return { success: true, exit_code: 0, stdout: 'https://github.com/o/r/pull/123\n', stderr: '' };
      if (command === 'git rev-parse HEAD') return { success: true, exit_code: 0, stdout: 'abc123\n', stderr: '' };
      return { success: true, exit_code: 0, stdout: '', stderr: '' };
    };

    const result = await commitAndOpenPr(
      {
        title: 'feat: scoped',
        body: 'body',
        file_paths: ['/repo/src/a.ts', 'src/a.ts'],
        cwd: '/repo',
      },
      runner,
    );
    expect(result.success).toBe(true);
    expect(commands.some((c) => c.startsWith('git status --porcelain -- '))).toBe(true);
    expect(commands.some((c) => c.startsWith("git add -- 'src/a.ts'"))).toBe(true);
    expect(commands.includes('git add -A')).toBe(false);
  });

  it('fails when file_paths is omitted', async () => {
    const runner = makeRunner([]);
    const result = await commitAndOpenPr(
      { title: 'feat: missing scope', body: 'body' },
      runner,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires file_paths');
  });
});

describe('hasSuccessfulPrToolCall', () => {
  it('detects successful PR tool calls', () => {
    const ok = hasSuccessfulPrToolCall([
      {
        tool_name: 'commit_and_open_pr',
        tool_result: JSON.stringify({
          success: true,
          pr_url: 'https://github.com/o/r/pull/1',
        }),
      },
    ]);
    expect(ok).toBe(true);
  });

  it('ignores failed or malformed entries', () => {
    const ok = hasSuccessfulPrToolCall([
      { tool_name: 'commit_and_open_pr', tool_result: '{"success":false}' },
      { tool_name: 'commit_and_open_pr', tool_result: 'not-json' },
      { tool_name: 'bash', tool_result: '{"success":true}' },
    ]);
    expect(ok).toBe(false);
  });
});
