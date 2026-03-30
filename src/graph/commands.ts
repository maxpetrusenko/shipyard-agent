/**
 * Frontend-invokable command shortcuts.
 *
 * Supports explicit slash commands and natural "show tools" asks without
 * consuming an LLM round-trip.
 */

import { TOOL_SCHEMAS } from '../tools/index.js';
import { hasSuccessfulPrToolCall } from '../tools/commit-and-open-pr.js';
import { revertChanges, type RevertChangesParams } from '../tools/revert-changes.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  rollbackWorkspaceCheckpoint,
} from '../runtime/checkpoints.js';
import { loadRunFromFile, loadRunsFromFiles } from '../runtime/persistence.js';

export interface CommandRuntimeControls {
  getStatus: () => {
    processing: boolean;
    currentRunId: string | null;
    queueLength: number;
    pauseRequested: boolean;
  };
  cancel: () => boolean;
  resume: (runId: string) => string | null;
}

let runtimeControls: CommandRuntimeControls | null = null;
const runtimeControlsStorage = new AsyncLocalStorage<CommandRuntimeControls>();

export function setCommandRuntimeControls(
  controls: CommandRuntimeControls | null,
): void {
  runtimeControls = controls;
}

export async function withCommandRuntimeControls<T>(
  controls: CommandRuntimeControls,
  fn: () => Promise<T>,
): Promise<T> {
  return runtimeControlsStorage.run(controls, fn);
}

function getRuntimeControls(): CommandRuntimeControls | null {
  return runtimeControlsStorage.getStore() ?? runtimeControls;
}

function toolListText(): string {
  const names = TOOL_SCHEMAS.map((t) => t.name).sort();
  return [
    'Invokable commands:',
    '- /tools or /help: show commands + tool names',
    '- /runs: list recent persisted runs (with edit counts)',
    '- /status: runtime queue + active run status',
    '- /cancel: request cancellation for the active run',
    '- /resume --run <runId>: resume an interrupted run',
    '- /checkpoints: list workspace checkpoints',
    '- /checkpoint [--run <runId>] [--file <path> ...]: snapshot current file contents',
    '- /rollback --checkpoint <id> [--dry-run] [--file <path> ...]: restore checkpoint',
    '- /undo: revert latest edited run (trace-based inverse)',
    '- /revert [--run <runId>] [--strategy trace|git] [--dry-run] [--file <path> ...]',
    '- /safety [--run <runId>]: deterministic post-run safety summary',
    '',
    'Available tools:',
    ...names.map((n) => `- ${n}`),
  ].join('\n');
}

function tokenize(instruction: string): string[] {
  return instruction.trim().split(/\s+/).filter(Boolean);
}

function parseRevertCommand(instruction: string): RevertChangesParams {
  const tokens = tokenize(instruction).slice(1);
  const out: RevertChangesParams = {
    scope: 'last_run',
    strategy: 'trace_edits',
    file_paths: [],
    dry_run: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!.trim();
    const next = tokens[i + 1]?.trim();
    if (tok === '--run' && next) {
      out.scope = 'run_id';
      out.run_id = next;
      i += 1;
      continue;
    }
    if (tok === '--strategy' && next) {
      out.strategy =
        next === 'git' || next === 'git_restore' ? 'git_restore' : 'trace_edits';
      i += 1;
      continue;
    }
    if (tok === '--dry-run' || tok === 'dry' || tok === 'preview') {
      out.dry_run = true;
      continue;
    }
    if (tok === '--file' && next) {
      out.file_paths!.push(next);
      i += 1;
      continue;
    }
    if (tok === 'git') {
      out.strategy = 'git_restore';
      continue;
    }
    if (tok === 'trace') {
      out.strategy = 'trace_edits';
      continue;
    }
    if (tok.startsWith('run:')) {
      out.scope = 'run_id';
      out.run_id = tok.slice(4);
      continue;
    }
  }

  return out;
}

function parseRunId(tokens: string[]): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const next = tokens[i + 1];
    if ((tok === '--run' || tok === '--id') && next) return next;
    if (tok.startsWith('run:')) return tok.slice(4);
  }
  return tokens[1] ?? null;
}

function parseFiles(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--file' && tokens[i + 1]) {
      out.push(tokens[i + 1]!);
      i += 1;
    }
  }
  return out;
}

function isToolsAsk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === 'tools' || t === 'help' || t === 'show tools') return true;
  return /(what|show|list).*(tools|commands)/i.test(text);
}

function recentRunsSorted(limit = 8) {
  return [...loadRunsFromFiles()]
    .sort((a, b) => {
      const ta = Date.parse(a.savedAt ?? a.startedAt ?? a.queuedAt ?? '') || 0;
      const tb = Date.parse(b.savedAt ?? b.startedAt ?? b.queuedAt ?? '') || 0;
      return tb - ta;
    })
    .slice(0, limit);
}

function recentRunsText(limit = 8): string {
  const runs = recentRunsSorted(limit);
  if (runs.length === 0) return 'No persisted runs found.';

  const rows = runs.map((r) => {
    const when = r.savedAt ?? r.startedAt ?? r.queuedAt ?? 'unknown-time';
    return `- ${r.runId} | phase=${r.phase} | edits=${r.fileEdits.length} | ${when}`;
  });
  return ['Recent runs:', ...rows].join('\n');
}

function statusText(): string {
  const controls = getRuntimeControls();
  if (!controls) {
    return ['Runtime status unavailable in this context.', recentRunsText(3)].join('\n\n');
  }
  const s = controls.getStatus();
  return [
    'Runtime status:',
    `- processing=${String(s.processing)}`,
    `- currentRunId=${s.currentRunId ?? 'none'}`,
    `- queueLength=${s.queueLength}`,
    `- pauseRequested=${String(s.pauseRequested)}`,
    '',
    recentRunsText(5),
  ].join('\n');
}

function safetySummary(runId?: string | null): string {
  const run = runId?.trim()
    ? loadRunFromFile(runId.trim())
    : recentRunsSorted(1)[0] ?? null;

  if (!run) return 'No run found for safety summary.';

  const verificationPassed = Boolean(run.verificationResult?.passed);
  const hasEdits = (run.fileEdits?.length ?? 0) > 0;
  const hasPr = hasSuccessfulPrToolCall(run.toolCallHistory ?? []);
  const hasError = Boolean(run.error);

  const lines = [
    `Safety summary for run ${run.runId}:`,
    `- phase=${run.phase}`,
    `- error=${hasError ? 'yes' : 'no'}`,
    `- verification_passed=${verificationPassed ? 'yes' : 'no'}`,
    `- edited_files=${hasEdits ? new Set(run.fileEdits.map((e) => e.file_path)).size : 0}`,
    `- pr_opened=${hasPr ? 'yes' : 'no'}`,
    '',
    'Recommended next command:',
  ];

  if (hasError || !verificationPassed) {
    lines.push(`- retry with fix feedback on run ${run.runId}`);
  } else if (hasEdits && !hasPr) {
    lines.push('- invoke commit_and_open_pr tool');
  } else if (hasEdits && hasPr) {
    lines.push('- continue iteration or request review');
  } else {
    lines.push('- clarify requested file changes');
  }

  return lines.join('\n');
}

function formatRevertResult(prefix: string, r: {
  success: boolean;
  outcome?: 'success' | 'partial' | 'failed';
  execution_scope?: 'local_only';
  run_id: string | null;
  strategy: string;
  targeted_files: string[];
  reverted_count: number;
  failed_count: number;
  action_receipts?: Array<{
    action: string;
    outcome: 'completed' | 'partial' | 'failed' | 'skipped';
    scope: 'local_only';
    details: string;
  }>;
  message: string;
}): string {
  const mode =
    r.strategy === 'git_restore'
      ? 'local workspace restore via git'
      : 'local workspace edit replay';
  const receipts = (r.action_receipts ?? []).map(
    (a) => `- ${a.action}: ${a.outcome} (${a.details})`,
  );
  return [
    `${prefix} ${r.success ? 'completed' : 'failed'}.`,
    `Outcome: ${r.outcome ?? (r.success ? 'success' : 'failed')}`,
    `Scope: ${r.execution_scope ?? 'local_only'} (no remote push/PR unless explicitly invoked)`,
    `Mode: ${mode}`,
    `Run: ${r.run_id ?? 'n/a'}`,
    `Strategy: ${r.strategy}`,
    `Targeted files: ${r.targeted_files.length}`,
    `Reverted: ${r.reverted_count}, Failed: ${r.failed_count}`,
    ...(receipts.length > 0 ? ['Actions:', ...receipts] : []),
    r.message,
  ].join('\n');
}

export async function tryCommandShortcut(
  instruction: string,
): Promise<string | null> {
  const trimmed = instruction.trim();
  if (!trimmed) return null;

  if (isToolsAsk(trimmed) || /^\/(tools|help)\b/i.test(trimmed)) {
    return toolListText();
  }

  if (/^\/runs\b/i.test(trimmed)) {
    return recentRunsText();
  }

  if (/^\/status\b/i.test(trimmed)) {
    return statusText();
  }

  if (/^\/cancel\b/i.test(trimmed)) {
    const controls = getRuntimeControls();
    if (!controls) return 'Cancel unavailable in this context.';
    const ok = controls.cancel();
    return ok ? 'Cancel requested for active run.' : 'No active run to cancel.';
  }

  if (/^\/resume\b/i.test(trimmed)) {
    const controls = getRuntimeControls();
    if (!controls) return 'Resume unavailable in this context.';
    const runId = parseRunId(tokenize(trimmed));
    if (!runId) return 'Usage: /resume --run <runId>';
    const resumed = controls.resume(runId);
    return resumed ? `Resumed run ${resumed}.` : `Could not resume run ${runId}.`;
  }

  if (/^\/checkpoints\b/i.test(trimmed)) {
    const cps = listWorkspaceCheckpoints(12);
    if (cps.length === 0) return 'No checkpoints found.';
    return [
      'Workspace checkpoints:',
      ...cps.map((cp) =>
        `- ${cp.checkpoint_id} | files=${cp.file_count} | run=${cp.run_id ?? 'n/a'} | ${cp.created_at}`,
      ),
    ].join('\n');
  }

  if (/^\/checkpoint\b/i.test(trimmed)) {
    const tokens = tokenize(trimmed);
    const runId = parseRunId(tokens);
    const labelIndex = tokens.findIndex((t) => t === '--label');
    const label = labelIndex >= 0 ? (tokens[labelIndex + 1] ?? undefined) : undefined;
    const files = parseFiles(tokens);
    const cp = createWorkspaceCheckpoint({
      run_id: runId && runId !== '/checkpoint' ? runId : undefined,
      label,
      file_paths: files.length > 0 ? files : undefined,
    });
    return [
      `Checkpoint ${cp.success ? 'created' : 'failed'}.`,
      `Checkpoint: ${cp.checkpoint_id ?? 'n/a'}`,
      `Run: ${cp.run_id ?? 'n/a'}`,
      `Files: ${cp.file_count}`,
      cp.message,
    ].join('\n');
  }

  if (/^\/rollback\b/i.test(trimmed)) {
    const tokens = tokenize(trimmed);
    const checkpointId = (() => {
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        const next = tokens[i + 1];
        if ((tok === '--checkpoint' || tok === '--id') && next) return next;
      }
      return tokens[1] ?? null;
    })();
    if (!checkpointId || checkpointId.startsWith('--')) {
      return 'Usage: /rollback --checkpoint <checkpointId> [--dry-run] [--file <path> ...]';
    }
    const files = parseFiles(tokens);
    const dryRun = tokens.includes('--dry-run');
    const rb = rollbackWorkspaceCheckpoint({
      checkpoint_id: checkpointId,
      dry_run: dryRun,
      file_paths: files.length > 0 ? files : undefined,
    });
    return [
      `Rollback ${rb.success ? 'completed' : 'failed'}.`,
      `Checkpoint: ${rb.checkpoint_id}`,
      `Targeted files: ${rb.targeted_files.length}`,
      `Restored: ${rb.restored_count}, Removed: ${rb.removed_count}, Failed: ${rb.failed_count}`,
      rb.message,
    ].join('\n');
  }

  if (/^\/undo\b/i.test(trimmed)) {
    const r = await revertChanges({ scope: 'last_run', strategy: 'trace_edits' });
    return formatRevertResult('Undo', r);
  }

  if (/^\/revert\b/i.test(trimmed)) {
    const params = parseRevertCommand(trimmed);
    const r = await revertChanges(params);
    return formatRevertResult('Revert', r);
  }

  if (/^\/safety\b/i.test(trimmed)) {
    const runId = parseRunId(tokenize(trimmed));
    return safetySummary(runId && runId !== '/safety' ? runId : undefined);
  }

  if (/^revert (the )?change(s)?$/i.test(trimmed)) {
    const r = await revertChanges({ scope: 'last_run', strategy: 'trace_edits' });
    return formatRevertResult('Revert', r);
  }

  return null;
}
