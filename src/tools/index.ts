/**
 * Tool registry: Anthropic tool schemas + dispatch.
 *
 * Each tool has a schema (for the Anthropic API) and a handler function.
 * Supports before/after hooks for recording, logging, and validation.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { editFile } from './edit-file.js';
import { readFileWithLineNumbers } from './read-file.js';
import { writeNewFile } from './write-file.js';
import { runBash } from './bash.js';
import { grepSearch } from './grep.js';
import { globSearch } from './glob.js';
import { listDirectory } from './ls.js';
import { spawnAgent } from './spawn-agent.js';
import { askUser } from './ask-user.js';
import { injectContext } from './inject-context.js';
import { commitAndOpenPr } from './commit-and-open-pr.js';
import { revertChanges } from './revert-changes.js';
import type { ToolHooks } from './hooks.js';
import { runBeforeHooks, runAfterHooks } from './hooks.js';
import type { FileOverlay } from './file-overlay.js';

// ---------------------------------------------------------------------------
// Anthropic tool schemas
// ---------------------------------------------------------------------------

const COMMIT_AND_OPEN_PR_TOOL_NAME = 'commit_and_open_pr';

const COMMIT_AND_OPEN_PR_TOOL: Anthropic.Tool = {
  name: COMMIT_AND_OPEN_PR_TOOL_NAME,
  description:
    'Commit all current changes, push branch, and open (or update) a GitHub draft PR via gh CLI.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'PR title' },
      body: { type: 'string', description: 'PR body markdown' },
      commit_message: { type: 'string', description: 'Git commit message (defaults to title)' },
      branch_name: { type: 'string', description: 'Branch to push (defaults to current branch)' },
      base_branch: { type: 'string', description: 'Base branch (defaults to repo default branch)' },
      file_paths: {
        type: 'array',
        description: 'Optional absolute/relative file paths to stage and commit (scoped commit)',
        items: { type: 'string' },
      },
      draft: { type: 'boolean', description: 'Create draft PR (default true)' },
    },
    required: ['title', 'body'],
  },
};

export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description:
      'Read a file with line numbers. Use offset/limit for large files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute or relative path to the file' },
        offset: { type: 'number', description: 'Starting line number (0-indexed)' },
        limit: { type: 'number', description: 'Max lines to return' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace old_string with new_string in a file. old_string must be unique. Uses 4-tier cascade: exact match -> whitespace-normalized -> fuzzy -> full rewrite.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact text to find and replace' },
        new_string: { type: 'string', description: 'The replacement text' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a file. Creates parent directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to write' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'bash',
    description:
      'Execute a shell command. Use for builds, tests, git operations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30s, max 120s)' },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
  },
  {
    name: 'grep',
    description:
      'Search file contents using ripgrep. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory or file to search in' },
        glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts")' },
        max_results: { type: 'number', description: 'Max matches (default 50)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'glob',
    description:
      'Find files matching a glob pattern. Returns sorted file paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
        cwd: { type: 'string', description: 'Base directory' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'ls',
    description: 'List directory contents with types and sizes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'spawn_agent',
    description:
      'Spawn a sub-agent to handle an independent subtask in parallel. The sub-agent gets its own context and tool set. Use for decomposing complex tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'The subtask instruction for the sub-agent' },
        role: { type: 'string', description: 'Specialist role (e.g. "frontend", "backend", "test")' },
      },
      required: ['task'],
    },
  },
  {
    name: 'ask_user',
    description:
      'Pause execution and ask the user a clarifying question. Use when the instruction is ambiguous or you need a decision.',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
      },
      required: ['question'],
    },
  },
  {
    name: 'revert_changes',
    description:
      'Revert prior agent edits dynamically across multiple files using run trace edits (default) or git restore. Use this when user says "revert the change".',
    input_schema: {
      type: 'object' as const,
      properties: {
        scope: {
          type: 'string',
          description: 'Target selection: "last_run" (default recent edited run) or "run_id"',
          enum: ['last_run', 'run_id'],
        },
        run_id: { type: 'string', description: 'Explicit run id when scope=run_id' },
        strategy: {
          type: 'string',
          description: 'Revert mode: "trace_edits" (inverse edit operations) or "git_restore" (restore files from git)',
          enum: ['trace_edits', 'git_restore'],
        },
        file_paths: {
          type: 'array',
          description: 'Optional absolute file paths to limit revert scope',
          items: { type: 'string' },
        },
        dry_run: { type: 'boolean', description: 'Preview only; do not modify files' },
      },
      required: ['scope'],
    },
  },
  COMMIT_AND_OPEN_PR_TOOL,
  {
    name: 'inject_context',
    description:
      'Inject additional context into the current run. The context will be available in subsequent turns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string', description: 'A short label for this context' },
        content: { type: 'string', description: 'The context content to inject' },
      },
      required: ['label', 'content'],
    },
  },
];

export function shouldAllowCommitAndOpenPrTool(instruction: string): boolean {
  const text = instruction.toLowerCase();
  if (
    /\b(?:do not|don't|no|without)\b[^.\n]{0,40}\b(?:commit|push|pr|pull request)\b/.test(text)
  ) {
    return false;
  }
  return [
    /\bcommit\b/,
    /\bpush\b/,
    /\bpr\b/,
    /\bpull request\b/,
  ].some((pattern) => pattern.test(text));
}

export function getExecutionToolSchemas(instruction: string): Anthropic.Tool[] {
  if (shouldAllowCommitAndOpenPrTool(instruction)) return TOOL_SCHEMAS;
  return TOOL_SCHEMAS.filter((tool) => tool.name !== COMMIT_AND_OPEN_PR_TOOL_NAME);
}

// ---------------------------------------------------------------------------
// Tool dispatch (raw, no hooks)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
async function dispatchToolRaw(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'read_file':
      return readFileWithLineNumbers(input as any) as any;
    case 'edit_file':
      return editFile(input as any) as any;
    case 'write_file':
      return writeNewFile(input as any) as any;
    case 'bash':
      return runBash(input as any) as any;
    case 'grep':
      return grepSearch(input as any) as any;
    case 'glob':
      return globSearch(input as any) as any;
    case 'ls':
      return listDirectory(input as any) as any;
    case 'spawn_agent':
      return spawnAgent(input as any) as any;
    case 'ask_user':
      return askUser(input as any) as any;
    case 'revert_changes':
      return revertChanges(input as any) as any;
    case 'commit_and_open_pr':
      return commitAndOpenPr(input as any) as any;
    case 'inject_context':
      return injectContext(input as any) as any;
    default:
      return { success: false, message: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Tool dispatch (with hooks + overlay)
// ---------------------------------------------------------------------------

/** File-mutating tools that need overlay snapshots. */
const MUTATING_TOOLS = new Set(['edit_file', 'write_file']);

/**
 * Dispatch a tool call with optional hooks and file overlay.
 *
 * - hooks: onBeforeToolCall/onAfterToolCall for recording, logging, etc.
 * - overlay: snapshots files before mutation for safe rollback.
 *
 * Backward-compatible: calling with just (name, input) works unchanged.
 */
export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
  hooks?: ToolHooks,
  overlay?: FileOverlay,
): Promise<Record<string, unknown>> {
  const ctx = { tool_name: name, tool_input: input };

  // Snapshot file before mutation
  if (overlay && MUTATING_TOOLS.has(name) && input['file_path']) {
    await overlay.snapshot(input['file_path'] as string);
  }

  // Before hooks
  if (hooks) await runBeforeHooks(hooks, ctx);

  const startTime = Date.now();
  const result = await dispatchToolRaw(name, input);
  const duration = Date.now() - startTime;

  // After hooks
  if (hooks) {
    await runAfterHooks(hooks, { ...ctx, tool_result: result, duration_ms: duration });
  }

  return result;
}
