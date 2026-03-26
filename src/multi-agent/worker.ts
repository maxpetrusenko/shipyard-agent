/**
 * Worker: isolated tool-call loop for a single subtask.
 *
 * Runs the same tool dispatch as executeNode but with its own context
 * window, overlay, and recording hooks. Does NOT re-enter the full
 * graph (no plan/verify/review cycle) — the coordinator owns that.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  getRateLimitFallbackModel,
  getResolvedModelConfig,
  isOpenAiModelId,
  type ModelFamily,
  type ModelRole,
} from '../config/model-policy.js';
import {
  getClient,
  wrapSystemPrompt,
  withCachedTools,
} from '../config/client.js';
import { getOpenAIClient } from '../config/openai-client.js';
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
import {
  assistantTextContent,
  addChatCompletionUsage,
  chatCompletionCreateWithRetry,
} from '../llm/openai-helpers.js';
import { anthropicToolSchemasToOpenAi } from '../llm/openai-tool-schemas.js';
import { appendOpenAiToolTurn } from '../llm/openai-chat-tool-turn.js';
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

export interface WorkerModelSelection {
  modelOverride?: string | null;
  modelFamily?: ModelFamily | null;
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
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

function isRateLimitLikeError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
  const norm = msg.toLowerCase();
  return (
    norm.includes('rate_limit') ||
    norm.includes('rate limit') ||
    norm.includes('too many requests') ||
    norm.includes(' 429') ||
    norm.startsWith('429 ')
  );
}

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
  modelSelection?: WorkerModelSelection,
): Promise<WorkerResult> {
  const startedAt = Date.now();
  const config = getResolvedModelConfig('coding', {
    modelFamily: modelSelection?.modelFamily ?? null,
    modelOverrides: modelSelection?.modelOverrides ?? null,
    legacyCodingOverride: modelSelection?.modelOverride ?? null,
  });

  // Build context block (separate cache breakpoint)
  const contextBlock = buildContextBlock(contexts);
  const contextSection = contextBlock ? `# Context\n\n${contextBlock}` : undefined;

  const runWithModel = async (model: string): Promise<WorkerResult> => {
    const fileEdits: FileEdit[] = [];
    const toolCallHistory: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(fileEdits, toolCallHistory);
    const overlay = new FileOverlay();

    try {
      if (isOpenAiModelId(model)) {
        const client = getOpenAIClient();
        const usageAcc = { input: 0, output: 0 };
        const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: 'user', content: `## Subtask (${subtaskId})\n${instruction}` },
        ];
        const workerOpenAiTools = anthropicToolSchemasToOpenAi(TOOL_SCHEMAS);
        const system = contextSection
          ? `${WORKER_SYSTEM}\n\n${contextSection}`
          : WORKER_SYSTEM;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const completion = await chatCompletionCreateWithRetry(client, {
            model,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            messages: [{ role: 'system', content: system }, ...conversation],
            tools: workerOpenAiTools,
            tool_choice: 'auto',
          }, {
            traceName: 'worker',
            traceMetadata: {
              node: 'worker',
              provider: 'openai',
              model,
              subtaskId,
            },
            traceTags: ['shipyard', 'worker', 'openai'],
          });
          addChatCompletionUsage(usageAcc, completion.usage);

          const choice = completion.choices[0];
          if (!choice) break;
          const msg = choice.message;
          const toolCalls = msg.tool_calls;
          const fullText = assistantTextContent(msg);

          if (toolCalls && toolCalls.length > 0) {
            await appendOpenAiToolTurn(
              conversation,
              msg,
              toolCalls,
              (name, input) => dispatchTool(name, input, hooks, overlay),
              { unsupportedToolMessage: 'Unsupported tool type for Shipyard worker' },
            );
            continue;
          }

          if (
            fullText.includes('SUBTASK_COMPLETE') ||
            fullText.includes('SUBTASK_BLOCKED') ||
            choice.finish_reason === 'stop'
          ) {
            return {
              subtaskId,
              phase: fullText.includes('SUBTASK_BLOCKED') ? 'error' : 'done',
              fileEdits,
              toolCallHistory,
              tokenUsage: usageAcc,
              error: fullText.includes('SUBTASK_BLOCKED')
                ? fullText.split('SUBTASK_BLOCKED:')[1]?.trim() ?? 'blocked'
                : null,
              durationMs: Date.now() - startedAt,
            };
          }

          break;
        }

        return {
          subtaskId,
          phase: 'done',
          fileEdits,
          toolCallHistory,
          tokenUsage: usageAcc,
          error: null,
          durationMs: Date.now() - startedAt,
        };
      }

      const anthropic = getClient();
      const tokens = new TokenAccumulator();
      const cachedTools = withCachedTools(TOOL_SCHEMAS);
      const systemPrompt = wrapSystemPrompt(WORKER_SYSTEM, contextSection);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: `## Subtask (${subtaskId})\n${instruction}` },
      ];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const requestMessages = stripToolResultCacheControls(messages);
        const response = await messagesCreate(
          anthropic,
          {
            model,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            system: systemPrompt,
            tools: cachedTools,
            messages: requestMessages,
          },
          {
            liveNode: 'worker',
            traceName: 'worker',
            traceMetadata: {
              node: 'worker',
              provider: 'anthropic',
              model,
              subtaskId,
            },
            traceTags: ['shipyard', 'worker', 'anthropic'],
          },
        );

        tokens.addAnthropicRound(response);

        const fullText = extractTextFromContentBlocks(response.content);
        const toolBlocks = extractToolUseBlocks(response.content);

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

        if (toolBlocks.length > 0) {
          messages.push({ role: 'assistant', content: response.content });
          const toolResults = await dispatchAnthropicToolBlocks(
            toolBlocks,
            (name, input) => dispatchTool(name, input, hooks, overlay),
          );
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        break;
      }

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
      if (overlay.dirty) {
        await overlay.rollbackAll().catch(() => {});
      }
      if (isRateLimitLikeError(err)) throw err;
      return {
        subtaskId,
        phase: 'error',
        fileEdits: [],
        toolCallHistory,
        tokenUsage: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  };

  try {
    return await runWithModel(config.model);
  } catch (err) {
    if (!isRateLimitLikeError(err)) {
      return {
        subtaskId,
        phase: 'error',
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }

    const fallbackModel = getRateLimitFallbackModel('coding', config.model);
    try {
      return await runWithModel(fallbackModel);
    } catch (fallbackErr) {
      return {
        subtaskId,
        phase: 'error',
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        error:
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        durationMs: Date.now() - startedAt,
      };
    }
  }
}
