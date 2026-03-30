/**
 * Worker: isolated tool-call loop for a single subtask.
 *
 * Runs the same tool dispatch as executeNode but with its own context
 * window, overlay, and recording hooks. Does NOT re-enter the full
 * graph (no plan/verify/review cycle) — the coordinator owns that.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { resolve } from 'node:path';
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
import { createIsolatedWorktree } from './worktree.js';
import {
  buildContextBlock,
  type FileEdit,
  type ToolCallRecord,
  type ContextEntry,
} from '../graph/state.js';

export interface WorkerResult {
  subtaskId: string;
  phase: 'done' | 'error';
  fileEdits: FileEdit[];
  fileOverlaySnapshots: string | null;
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

function remapOverlaySnapshots(
  snapshots: string | null,
  fromDir: string,
  toDir: string,
): string | null {
  if (!snapshots) return snapshots;
  const parsed = JSON.parse(snapshots) as Record<string, string | null>;
  const remapped: Record<string, string | null> = {};
  for (const [filePath, content] of Object.entries(parsed)) {
    remapped[remapString(filePath, fromDir, toDir)] = content
      ? remapString(content, fromDir, toDir)
      : content;
  }
  return JSON.stringify(remapped);
}

export interface WorkerModelSelection {
  modelOverride?: string | null;
  modelFamily?: ModelFamily | null;
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
  isolateInWorktree?: boolean;
  workDir?: string | null;
}

function buildWorkerSystem(workDir: string): string {
  return `You are Shipyard Worker, an autonomous coding agent executing a single subtask.

IMPORTANT: The target codebase is at: ${workDir}
All file paths must be absolute, rooted at ${workDir}.
When using bash, always cd to ${workDir} first or use absolute paths.

Rules:
- Read files before editing (understand before modifying)
- Use edit_file for surgical changes (preferred over write_file)
- Use write_file only for new files
- If the assigned workdir is empty or brand-new and the task is to build/rebuild/create an app there, bootstrap the project in that directory rather than treating emptiness as a blocker
- Initializing a fresh git repo in the assigned workdir is allowed when it helps establish the project
- For a brand-new app bootstrap, leave working local run/build/test scripts behind; if the app starts from zero tests, add a minimal smoke test instead of leaving the test command broken
- Never use bash to run apply_patch, git apply, sed -i, perl -i, or other shell editing tricks; use edit_file/write_file instead
- Make one logical change at a time
- If converting an existing file into a wrapper, shim, or pure re-export, replace the entire file contents; do not prepend a new export onto the old implementation
- If a file should only re-export another module, the final file must contain only the wrapper/re-export code plus any required header comments
- When your subtask is complete, say "SUBTASK_COMPLETE" in your response
- If you cannot complete the subtask, say "SUBTASK_BLOCKED: <reason>"`;
}

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

function remapString(value: string, fromDir: string, toDir: string): string {
  if (!fromDir || fromDir === toDir || !value.includes(fromDir)) return value;
  return value.split(fromDir).join(toDir);
}

function remapValue<T>(value: T, fromDir: string, toDir: string): T {
  if (typeof value === 'string') {
    return remapString(value, fromDir, toDir) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapValue(entry, fromDir, toDir)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        remapValue(entry, fromDir, toDir),
      ]),
    ) as T;
  }
  return value;
}

function normalizePathInput(value: unknown, workDir: string): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return value.startsWith('/') ? value : resolve(workDir, value);
}

function normalizeWorkerInput(
  name: string,
  input: Record<string, unknown>,
  workDir: string,
): Record<string, unknown> {
  const next = { ...input };

  if (name === 'read_file' || name === 'edit_file' || name === 'write_file') {
    const resolved = normalizePathInput(next['file_path'], workDir);
    if (resolved) next['file_path'] = resolved;
  }

  if (name === 'grep') {
    next['path'] = normalizePathInput(next['path'], workDir) ?? workDir;
  }

  if (name === 'glob') {
    next['cwd'] = normalizePathInput(next['cwd'], workDir) ?? workDir;
  }

  if (name === 'ls') {
    next['path'] = normalizePathInput(next['path'], workDir) ?? workDir;
  }

  if (name === 'bash') {
    next['cwd'] = normalizePathInput(next['cwd'], workDir) ?? workDir;
  }

  return next;
}

function normalizeWorkerResult(
  result: WorkerResult,
  isolatedWorkDir: string,
  logicalWorkDir: string,
): WorkerResult {
  return {
    ...result,
    fileEdits: result.fileEdits.map((edit) => ({
      ...edit,
      file_path: remapString(edit.file_path, isolatedWorkDir, logicalWorkDir),
    })),
    fileOverlaySnapshots: remapOverlaySnapshots(
      result.fileOverlaySnapshots,
      isolatedWorkDir,
      logicalWorkDir,
    ),
    toolCallHistory: remapValue(result.toolCallHistory, isolatedWorkDir, logicalWorkDir),
    error: result.error
      ? remapString(result.error, isolatedWorkDir, logicalWorkDir)
      : result.error,
  };
}

export async function runWorker(
  subtaskId: string,
  instruction: string,
  contexts: ContextEntry[],
  modelSelection?: WorkerModelSelection,
): Promise<WorkerResult> {
  const startedAt = Date.now();
  const logicalWorkDir = modelSelection?.workDir?.trim() || process.env['SHIPYARD_WORK_DIR'] || process.cwd();
  const config = getResolvedModelConfig('coding', {
    modelFamily: modelSelection?.modelFamily ?? null,
    modelOverrides: modelSelection?.modelOverrides ?? null,
    legacyCodingOverride: modelSelection?.modelOverride ?? null,
  });

  let isolated = null as Awaited<ReturnType<typeof createIsolatedWorktree>> | null;
  let activeWorkDir = logicalWorkDir;

  if (modelSelection?.isolateInWorktree) {
    try {
      isolated = await createIsolatedWorktree(logicalWorkDir, subtaskId);
      activeWorkDir = isolated.worktreeDir;
    } catch (err) {
        return {
          subtaskId,
          phase: 'error',
          fileEdits: [],
          fileOverlaySnapshots: null,
          toolCallHistory: [],
          tokenUsage: null,
          error: `Failed to create isolated worktree: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const rewrittenInstruction = remapString(instruction, logicalWorkDir, activeWorkDir);
  const rewrittenContexts = contexts.map((entry) => ({
    ...entry,
    content: remapString(entry.content, logicalWorkDir, activeWorkDir),
  }));
  const contextBlock = buildContextBlock(rewrittenContexts);
  const contextSection = contextBlock ? `# Context\n\n${contextBlock}` : undefined;
  const workerSystem = buildWorkerSystem(activeWorkDir);

  const runWithModel = async (model: string): Promise<WorkerResult> => {
    const fileEdits: FileEdit[] = [];
    const toolCallHistory: ToolCallRecord[] = [];
    const hooks = createRecordingHooks(fileEdits, toolCallHistory);
    const overlay = new FileOverlay();
    const dispatchWorkerTool = (
      name: string,
      input: Record<string, unknown>,
    ) => dispatchTool(
      name,
      normalizeWorkerInput(name, input, activeWorkDir),
      hooks,
      overlay,
      activeWorkDir,
    );

    try {
      if (isOpenAiModelId(model)) {
        const client = getOpenAIClient();
        const usageAcc = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: 'user', content: `## Subtask (${subtaskId})\n${rewrittenInstruction}` },
        ];
        const workerOpenAiTools = anthropicToolSchemasToOpenAi(TOOL_SCHEMAS);
        const system = contextSection
          ? `${workerSystem}\n\n${contextSection}`
          : workerSystem;

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
              (name, input) => dispatchWorkerTool(name, input),
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
              fileOverlaySnapshots: overlay.dirty ? overlay.serialize() : null,
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
          fileOverlaySnapshots: overlay.dirty ? overlay.serialize() : null,
          toolCallHistory,
          tokenUsage: usageAcc,
          error: null,
          durationMs: Date.now() - startedAt,
        };
      }

      const anthropic = getClient();
      const tokens = new TokenAccumulator();
      const cachedTools = withCachedTools(TOOL_SCHEMAS);
      const systemPrompt = wrapSystemPrompt(workerSystem, contextSection);
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: `## Subtask (${subtaskId})\n${rewrittenInstruction}` },
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
            fileOverlaySnapshots: overlay.dirty ? overlay.serialize() : null,
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
            (name, input) => dispatchWorkerTool(name, input),
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
        fileOverlaySnapshots: overlay.dirty ? overlay.serialize() : null,
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
          fileOverlaySnapshots: null,
          toolCallHistory,
          tokenUsage: null,
          error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  };

  try {
    const result = await (async () => {
      try {
        return await runWithModel(config.model);
      } catch (err) {
        if (!isRateLimitLikeError(err)) {
          return {
            subtaskId,
            phase: 'error' as const,
            fileEdits: [],
            fileOverlaySnapshots: null,
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
            phase: 'error' as const,
            fileEdits: [],
            fileOverlaySnapshots: null,
            toolCallHistory: [],
            tokenUsage: null,
            error:
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            durationMs: Date.now() - startedAt,
          };
        }
      }
    })();

    if (!isolated) return result;
    return normalizeWorkerResult(result, activeWorkDir, logicalWorkDir);
  } finally {
    await isolated?.cleanup();
  }
}
