/**
 * Tool call interception hooks (pattern from vercel-labs/bash-tool).
 *
 * Hooks run before/after every dispatchTool call. They decouple
 * recording, validation, and metrics from node logic.
 */

import type { FileEdit, ToolCallRecord } from '../graph/state.js';

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
 */
export function createRecordingHooks(
  edits: FileEdit[],
  history: ToolCallRecord[],
): Required<ToolHooks> {
  const onAfterToolCall: AfterHook[] = [
    (ctx) => {
      // Record edit_file results
      if (ctx.tool_name === 'edit_file' && ctx.tool_result.success) {
        edits.push({
          file_path: ctx.tool_input['file_path'] as string,
          tier: ctx.tool_result['tier'] as 1 | 2 | 3 | 4,
          old_string: ctx.tool_input['old_string'] as string,
          new_string: ctx.tool_input['new_string'] as string,
          timestamp: Date.now(),
        });
      }

      // Record all tool calls
      history.push({
        tool_name: ctx.tool_name,
        tool_input: ctx.tool_input,
        tool_result: JSON.stringify(ctx.tool_result).slice(0, 10_000),
        timestamp: Date.now(),
        duration_ms: ctx.duration_ms,
      });
    },
  ];

  return { onBeforeToolCall: [], onAfterToolCall };
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
