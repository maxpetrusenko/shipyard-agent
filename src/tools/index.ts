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
import type { ToolHooks } from './hooks.js';
import { runBeforeHooks, runAfterHooks } from './hooks.js';
import type { FileOverlay } from './file-overlay.js';

// ---------------------------------------------------------------------------
// Anthropic tool schemas
// ---------------------------------------------------------------------------

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
];

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
