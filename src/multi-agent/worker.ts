/**
 * Worker: isolated tool-call loop for a single subtask.
 *
 * Runs the same tool dispatch as executeNode but with its own context
 * window, overlay, and recording hooks. Does NOT re-enter the full
 * graph (no plan/verify/review cycle) — the coordinator owns that.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../config/model-policy.js';
import {
  getClient,
  wrapSystemPrompt,
  withCachedTools,
} from '../config/client.js';
import { WORK_DIR } from '../config/work-dir.js';
import { messagesCreate } from '../config/messages-create.js';
import {
  dispatchAnthropicToolBlocks,
  stripToolResultCacheControls,
} from '../llm/anthropic-tool-dispatch.js';
import {
  extractTextFromContentBlocks,
  extractToolUseBlocks,
} from '../llm/anthropic-parse.js';
import { TokenAccumulator } from '../llm/token-usage.js';
import { TOOL_SCHEMAS, dispatchTool } from '../tools/index.js';
import { createRecordingHooks } from '../tools/hooks.js';
import { FileOverlay } from '../tools/file-overlay.js';
import {
  buildContextBlock,
  type FileEdit,
  type ToolCallRecord,
  type ContextEntry,
} from '../graph/state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerResult {
  subtaskId: string;
  phase: 'done' | 'error';
  fileEdits: FileEdit[];
  toolCallHistory: ToolCallRecord[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  } | null;
  error: string | null;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const WORKER_SYSTEM = `You are Shipyard Worker, an autonomous coding agent executing a single subtask.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

Rules:
- Read files before editing (understand before modifying)
- Use edit_file for surgical changes (preferred over write_file)
- Use write_file only for new files
- Make one logical change at a time
- When your subtask is complete, say "SUBTASK_COMPLETE" in your response
- If you cannot complete the subtask, say "SUBTASK_BLOCKED: <reason>"`;

// ---------------------------------------------------------------------------
// Max tool rounds per worker (bounded to prevent runaway)
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 20;

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

/**
 * Execute a subtask in isolation using the Anthropic tool-call loop.
 *
 * Each worker gets:
 * - Its own conversation history (no cross-contamination)
 * - Its own FileOverlay (rollback-safe)
 * - Its own recording hooks
 *
 * Returns file edits, tool call history, and token usage.
 */
export async function runWorker(
  subtaskId: string,
  instruction: string,
  contexts: ContextEntry[],
): Promise<WorkerResult> {
  const startedAt = Date.now();
  const config = getModelConfig('coding');
  const anthropic = getClient();

  // Build context block (separate cache breakpoint)
  const contextBlock = buildContextBlock(contexts);

  const systemPrompt = wrapSystemPrompt(
    WORKER_SYSTEM,
    contextBlock ? `# Context\n\n${contextBlock}` : undefined,
  );

  // Isolated state per worker
  const fileEdits: FileEdit[] = [];
  const toolCallHistory: ToolCallRecord[] = [];
  const hooks = createRecordingHooks(fileEdits, toolCallHistory);
  const overlay = new FileOverlay();

  const tokens = new TokenAccumulator();

  const cachedTools = withCachedTools(TOOL_SCHEMAS);

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `## Subtask (${subtaskId})\n${instruction}`,
    },
  ];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const requestMessages = stripToolResultCacheControls(messages);
      const response = await messagesCreate(anthropic, {
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: systemPrompt,
        tools: cachedTools,
        messages: requestMessages,
      }, { liveNode: 'worker' });

      tokens.addAnthropicRound(response);

      const fullText = extractTextFromContentBlocks(response.content);
      const toolBlocks = extractToolUseBlocks(response.content);

      // Check completion signals
      if (
        fullText.includes('SUBTASK_COMPLETE') ||
        fullText.includes('SUBTASK_BLOCKED') ||
        response.stop_reason === 'end_turn'
      ) {
        return {
          subtaskId,
          phase: fullText.includes('SUBTASK_BLOCKED') ? 'error' : 'done',
          fileEdits,
          toolCallHistory,
          tokenUsage: tokens.snapshot(),
          error: fullText.includes('SUBTASK_BLOCKED')
            ? fullText.split('SUBTASK_BLOCKED:')[1]?.trim() ?? 'blocked'
            : null,
          durationMs: Date.now() - startedAt,
        };
      }

      // Execute tool calls
      if (toolBlocks.length > 0) {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = await dispatchAnthropicToolBlocks(
          toolBlocks,
          (name, input) => dispatchTool(name, input, hooks, overlay),
        );
        messages.push({ role: 'user', content: toolResults });
      } else {
        // No tools, not complete — break to avoid spinning
        break;
      }
    }

    // Hit max rounds — return what we have
    return {
      subtaskId,
      phase: 'done',
      fileEdits,
      toolCallHistory,
      tokenUsage: tokens.snapshot(),
      error: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: unknown) {
    // Rollback on failure
    if (overlay.dirty) {
      await overlay.rollbackAll().catch(() => {});
    }

    return {
      subtaskId,
      phase: 'error',
      fileEdits: [],
      toolCallHistory,
      tokenUsage: tokens.snapshot(),
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}
