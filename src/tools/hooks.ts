/**
 * Tool call interception hooks (pattern from vercel-labs/bash-tool).
 *
 * Hooks run before/after every dispatchTool call. They decouple
 * recording, validation, and metrics from node logic.
 */

import type { FileEdit, ToolCallRecord } from '../graph/state.js';

// ---------------------------------------------------------------------------
// Live feed (dashboard WebSocket): module listener set by InstructionLoop
// ---------------------------------------------------------------------------

export type LiveFeedEvent =
  | { type: 'file_edit'; edit: FileEdit }
  | {
      type: 'tool';
      tool_name: string;
      ok: boolean;
      file_path?: string;
      detail: string;
      timestamp: number;
    }
  | {
      type: 'text_chunk';
      node: string;
      text: string;
      timestamp: number;
    };

let liveFeedListener: ((event: LiveFeedEvent) => void) | null = null;

export function setLiveFeedListener(
  fn: ((event: LiveFeedEvent) => void) | null,
): void {
  liveFeedListener = fn;
}

function emitLiveFeed(event: LiveFeedEvent): void {
  try {
    liveFeedListener?.(event);
  } catch {
    // Listener errors must not break tool dispatch
  }
}

export function emitTextChunk(node: string, text: string): void {
  emitLiveFeed({ type: 'text_chunk', node, text, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface ToolCallContext {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolCallResult extends ToolCallContext {
  tool_result: Record<string, unknown>;
  duration_ms: number;
}

export type BeforeHook = (ctx: ToolCallContext) => void | Promise<void>;
export type AfterHook = (ctx: ToolCallResult) => void | Promise<void>;

export interface ToolHooks {
  onBeforeToolCall?: BeforeHook[];
  onAfterToolCall?: AfterHook[];
}

function summarizeToolInput(ctx: ToolCallResult): string {
  const name = ctx.tool_name;
  const input = ctx.tool_input;
  if (name === 'bash') {
    const c = input['command'];
    return typeof c === 'string' ? c.slice(0, 240) : '';
  }
  if (name === 'read_file' || name === 'edit_file' || name === 'write_file') {
    const p = input['file_path'];
    return typeof p === 'string' ? p : '';
  }
  if (name === 'grep') {
    const pat = input['pattern'];
    const path = input['path'];
    return [pat, path].filter(Boolean).join(' @ ').slice(0, 200);
  }
  if (name === 'glob') {
    const pat = input['pattern'];
    return typeof pat === 'string' ? pat : '';
  }
  if (name === 'ls') {
    const p = input['path'];
    return typeof p === 'string' ? p : '.';
  }
  return JSON.stringify(input).slice(0, 160);
}

// ---------------------------------------------------------------------------
// Hook runner
// ---------------------------------------------------------------------------

export async function runBeforeHooks(
  hooks: ToolHooks,
  ctx: ToolCallContext,
): Promise<void> {
  if (!hooks.onBeforeToolCall) return;
  for (const fn of hooks.onBeforeToolCall) {
    await fn(ctx);
  }
}

export async function runAfterHooks(
  hooks: ToolHooks,
  ctx: ToolCallResult,
): Promise<void> {
  if (!hooks.onAfterToolCall) return;
  for (const fn of hooks.onAfterToolCall) {
    await fn(ctx);
  }
}

// ---------------------------------------------------------------------------
// Built-in hooks: recording
// ---------------------------------------------------------------------------

/**
 * Creates a hook pair that records tool calls into provided arrays.
 * Replaces the inline recording logic formerly in execute.ts.
 *
 * When `setLiveFeedListener` is set (by the instruction loop), successful
 * file mutations emit `file_edit` and other tools emit `tool` events for the
 * dashboard.
 */
export function createRecordingHooks(
  edits: FileEdit[],
  history: ToolCallRecord[],
): Required<ToolHooks> {
  const onAfterToolCall: AfterHook[] = [
    (ctx) => {
      const ok = Boolean(ctx.tool_result['success']);

      // Record edit_file results
      if (ctx.tool_name === 'edit_file' && ok) {
        const edit: FileEdit = {
          file_path: ctx.tool_input['file_path'] as string,
          tier: ctx.tool_result['tier'] as 1 | 2 | 3 | 4,
          old_string: ctx.tool_input['old_string'] as string,
          new_string: ctx.tool_input['new_string'] as string,
          timestamp: Date.now(),
        };
        edits.push(edit);
        emitLiveFeed({ type: 'file_edit', edit });
      } else if (ctx.tool_name === 'write_file' && ok) {
        const edit: FileEdit = {
          file_path: ctx.tool_input['file_path'] as string,
          tier: 4,
          old_string: '',
          new_string: ctx.tool_input['content'] as string,
          timestamp: Date.now(),
        };
        edits.push(edit);
        emitLiveFeed({ type: 'file_edit', edit });
      }

      // Record all tool calls
      history.push({
        tool_name: ctx.tool_name,
        tool_input: ctx.tool_input,
        tool_result: JSON.stringify(ctx.tool_result).slice(0, 10_000),
        timestamp: Date.now(),
        duration_ms: ctx.duration_ms,
      });

      const fileMutatorOk =
        (ctx.tool_name === 'edit_file' && ok) ||
        (ctx.tool_name === 'write_file' && ok);
      if (!fileMutatorOk) {
        const fp = ctx.tool_input['file_path'];
        emitLiveFeed({
          type: 'tool',
          tool_name: ctx.tool_name,
          ok,
          file_path: typeof fp === 'string' ? fp : undefined,
          detail: summarizeToolInput(ctx),
          timestamp: Date.now(),
        });
      }
    },
  ];

  return { onBeforeToolCall: [], onAfterToolCall };
}

/**
 * Lightweight after-hook for plan-node exploration tools (read_file, grep,
 * etc.). Plan does not use createRecordingHooks; this still streams activity
 * when `setLiveFeedListener` is active.
 */
export function createPlanLiveHooks(): ToolHooks {
  return {
    onAfterToolCall: [
      (ctx) => {
        const ok = Boolean(ctx.tool_result['success']);
        const fp = ctx.tool_input['file_path'];
        emitLiveFeed({
          type: 'tool',
          tool_name: ctx.tool_name,
          ok,
          file_path: typeof fp === 'string' ? fp : undefined,
          detail: summarizeToolInput(ctx),
          timestamp: Date.now(),
        });
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Built-in hooks: cost accumulation
// ---------------------------------------------------------------------------

/**
 * Creates a hook that accumulates estimated cost for LLM-backed tool calls.
 * `costRef` is mutated in place: { value: number }.
 */
export function createCostHook(
  costRef: { value: number },
  costFn: (model: string, input: number, output: number) => number,
  model: string,
): Required<ToolHooks> {
  return {
    onBeforeToolCall: [],
    onAfterToolCall: [
      (ctx) => {
        // Only accumulate for tool calls that report token usage
        const usage = ctx.tool_result['tokenUsage'] as
          | { input: number; output: number }
          | undefined;
        if (usage) {
          costRef.value += costFn(model, usage.input, usage.output);
        }
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Built-in hooks: logging
// ---------------------------------------------------------------------------

/**
 * Creates a hook that logs tool calls to console (useful for debugging).
 */
export function createLoggingHooks(): Required<ToolHooks> {
  return {
    onBeforeToolCall: [
      (ctx) => {
        const inputPreview = JSON.stringify(ctx.tool_input).slice(0, 200);
        console.log(`[tool] ${ctx.tool_name} ${inputPreview}`);
      },
    ],
    onAfterToolCall: [
      (ctx) => {
        const ok = ctx.tool_result.success ? 'ok' : 'fail';
        console.log(`[tool] ${ctx.tool_name} ${ok} (${ctx.duration_ms}ms)`);
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Merge hooks
// ---------------------------------------------------------------------------

export function mergeHooks(...hookSets: ToolHooks[]): ToolHooks {
  const merged: Required<ToolHooks> = {
    onBeforeToolCall: [],
    onAfterToolCall: [],
  };
  for (const h of hookSets) {
    if (h.onBeforeToolCall) merged.onBeforeToolCall.push(...h.onBeforeToolCall);
    if (h.onAfterToolCall) merged.onAfterToolCall.push(...h.onAfterToolCall);
  }
  return merged;
}
