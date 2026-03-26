/**
 * Execute-node LLM loop via OpenAI Chat Completions + function tools.
 * Used when the run's coding model override is an OpenAI model id (e.g. gpt-5.1-codex).
 */
import OpenAI from 'openai';
import { getOpenAIClient } from '../../config/openai-client.js';
import type { ModelConfig } from '../../config/model-policy.js';
import {
  dispatchTool,
  getExecutionToolSchemas,
} from '../../tools/index.js';
import { emitTextChunk, type ToolHooks } from '../../tools/hooks.js';
import type { FileOverlay } from '../../tools/file-overlay.js';
import { anthropicToolSchemasToOpenAi } from '../../llm/openai-tool-schemas.js';
import {
  assistantTextContent,
  addChatCompletionUsage,
  chatCompletionCreateWithRetry,
} from '../../llm/openai-helpers.js';
import { appendOpenAiToolTurn } from '../../llm/openai-chat-tool-turn.js';
import { compactOpenAiMessages } from '../../llm/openai-message-compaction.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import {
  deriveDiscoveryCallLimit,
  deriveFirstEditDeadlineMs,
  evaluateCandidateEditPath,
  isDiscoveryToolName,
} from '../guards.js';
import type {
  ShipyardStateType,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
} from '../state.js';

const MAX_NO_EDIT_TOOL_ROUNDS = 8;
const MAX_FORCED_EDIT_NUDGES = 1;
const EXECUTE_OPENAI_COMPACTION_MAX_CHARS = 100_000;

function forcedEditNudge(
  discoveryCallsBeforeFirstEdit: number,
  discoveryCallLimit: number | null,
): string {
  const limitMsg =
    discoveryCallLimit != null
      ? `${discoveryCallsBeforeFirstEdit}/${discoveryCallLimit}`
      : `${discoveryCallsBeforeFirstEdit}`;
  return (
    `You are drifting in discovery with no file edits.\n` +
    `Discovery calls before first edit: ${limitMsg}.\n` +
    `Now do this immediately:\n` +
    `1) Pick ONE concrete target file.\n` +
    `2) Call edit_file with a minimal bugfix in that file.\n` +
    `3) If blocked, return one blocker and 2 concrete options.\n` +
    `Do not run more broad scans before the edit attempt.`
  );
}

export async function runOpenAiExecuteLoop(params: {
  state: ShipyardStateType;
  config: ModelConfig;
  system: string;
  stepPrompt: string;
  hooks: ToolHooks;
  overlay: FileOverlay;
  updatedSteps: ShipyardStateType['steps'];
}): Promise<Partial<ShipyardStateType>> {
  const { state, config, system, stepPrompt, hooks, overlay, updatedSteps } =
    params;
  const client = getOpenAIClient();
  const openAiTools = anthropicToolSchemasToOpenAi(
    getExecutionToolSchemas(state.instruction),
  );

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: stepPrompt },
  ];

  const usageAcc = {
    input: state.tokenUsage?.input ?? 0,
    output: state.tokenUsage?.output ?? 0,
    cacheRead: state.tokenUsage?.cacheRead ?? 0,
    cacheCreation: state.tokenUsage?.cacheCreation ?? 0,
  };
  const newEdits: FileEdit[] = [...state.fileEdits];
  const newHistory: ToolCallRecord[] = [...state.toolCallHistory];
  const newMessages: LLMMessage[] = [...state.messages];
  const maxToolRounds = 25;
  let noEditToolRounds = 0;
  const discoveryCallLimit = deriveDiscoveryCallLimit(state.instruction);
  const firstEditDeadlineMs = deriveFirstEditDeadlineMs(state.instruction);
  const firstEditWindowStart = state.fileEdits.length === 0 ? Date.now() : null;
  let discoveryCallsBeforeFirstEdit =
    state.fileEdits.length === 0
      ? state.toolCallHistory.filter((t) => isDiscoveryToolName(t.tool_name)).length
      : 0;
  let guardrailViolation: string | null = null;
  let forcedEditNudges = 0;

  const buildReturn = (
    fullText: string,
    finalSteps: ShipyardStateType['steps'],
  ): Partial<ShipyardStateType> => {
    newMessages.push({ role: 'assistant', content: fullText });
    const snapshotJson = overlay.dirty
      ? JSON.stringify(
          Object.fromEntries(overlay.trackedFiles().map((f) => [f, ''])),
        )
      : state.fileOverlaySnapshots ?? null;
    return {
      phase: 'verifying',
      steps: finalSteps,
      fileEdits: newEdits,
      toolCallHistory: newHistory,
      messages: newMessages,
      tokenUsage: {
        input: usageAcc.input,
        output: usageAcc.output,
        cacheRead: usageAcc.cacheRead,
        cacheCreation: usageAcc.cacheCreation,
      },
      fileOverlaySnapshots: snapshotJson,
    };
  };

  for (let round = 0; round < maxToolRounds; round++) {
    const liveFollowups = consumeLiveFollowups(state.runId);
    if (liveFollowups.length > 0) {
      conversation.push({
        role: 'user',
        content: liveFollowups.join('\n\n'),
      });
      newMessages.push({
        role: 'assistant',
        content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before execution call.`,
      });
    }

    const compacted = compactOpenAiMessages(conversation, {
      maxChars: EXECUTE_OPENAI_COMPACTION_MAX_CHARS,
      preserveRecentMessages: 10,
    });
    if (compacted.compacted) {
      newMessages.push({
        role: 'assistant',
        content:
          `[Compaction] execution history compacted (${compacted.beforeChars} -> ${compacted.afterChars} chars, dropped ${compacted.droppedMessages} messages).`,
      });
    }

    const completion = await chatCompletionCreateWithRetry(client, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [{ role: 'system', content: system }, ...compacted.messages],
      tools: openAiTools,
      tool_choice: 'auto',
    }, {
      traceName: 'execute',
      traceMetadata: { node: 'execute', provider: 'openai', model: config.model },
      traceTags: ['shipyard', 'execute', 'openai'],
    });

    addChatCompletionUsage(usageAcc, completion.usage);

    const choice = completion.choices[0];
    if (!choice) {
      break;
    }

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const editsBefore = newEdits.length;
      await appendOpenAiToolTurn(
        conversation,
        msg,
        toolCalls,
        async (name, input) => {
          const hasEdits = state.fileEdits.length + newEdits.length > 0;
          if (
            !hasEdits &&
            firstEditWindowStart != null &&
            firstEditDeadlineMs != null
          ) {
            const elapsed = Date.now() - firstEditWindowStart;
            if (elapsed > firstEditDeadlineMs) {
              guardrailViolation =
                `Watchdog: first edit deadline exceeded (${elapsed}ms > ${firstEditDeadlineMs}ms).`;
              return { success: false, message: guardrailViolation };
            }
          }
          if (!hasEdits && isDiscoveryToolName(name)) {
            discoveryCallsBeforeFirstEdit += 1;
            if (
              discoveryCallLimit != null &&
              discoveryCallsBeforeFirstEdit > discoveryCallLimit
            ) {
              guardrailViolation =
                `Watchdog: discovery tool calls before first edit exceeded limit (${discoveryCallsBeforeFirstEdit}/${discoveryCallLimit}).`;
              return { success: false, message: guardrailViolation };
            }
          }
          if (name === 'edit_file' || name === 'write_file') {
            const candidatePath = input['file_path'];
            if (typeof candidatePath === 'string' && candidatePath.trim()) {
              const editedPaths = [
                ...new Set([...state.fileEdits, ...newEdits].map((e) => e.file_path)),
              ];
              const scopeCheck = evaluateCandidateEditPath({
                instruction: state.instruction,
                steps: state.steps,
                editedPaths,
                candidatePath,
              });
              if (!scopeCheck.ok) {
                guardrailViolation = `Watchdog: ${scopeCheck.reason ?? 'edit scope violation.'}`;
                return { success: false, message: guardrailViolation };
              }
            }
          }
          return dispatchTool(name, input, hooks, overlay);
        },
        {
          unsupportedToolMessage: 'Unsupported tool call type for Shipyard',
        },
      );
      if (guardrailViolation) {
        throw new Error(guardrailViolation);
      }

      if (newEdits.length === editsBefore) {
        noEditToolRounds += 1;
      } else {
        noEditToolRounds = 0;
      }

      if (noEditToolRounds >= MAX_NO_EDIT_TOOL_ROUNDS) {
        if (newEdits.length === 0 && forcedEditNudges < MAX_FORCED_EDIT_NUDGES) {
          forcedEditNudges += 1;
          noEditToolRounds = 0;
          conversation.push({
            role: 'user',
            content: forcedEditNudge(
              discoveryCallsBeforeFirstEdit,
              discoveryCallLimit,
            ),
          });
          newMessages.push({
            role: 'assistant',
            content:
              `[Watchdog] Recovery nudge ${forcedEditNudges}/${MAX_FORCED_EDIT_NUDGES}: forcing one concrete edit attempt now.`,
          });
          continue;
        }
        throw new Error(
          `Watchdog: execution stalled after ${MAX_NO_EDIT_TOOL_ROUNDS} consecutive no-edit tool rounds.`,
        );
      }
      continue;
    }

    const textContent = assistantTextContent(msg);
    if (textContent.trim()) emitTextChunk('execute', textContent);
    const isExplicitComplete = textContent.includes('STEP_COMPLETE');
    const isStopNoTools = choice.finish_reason === 'stop';
    if (isExplicitComplete || isStopNoTools) {
      const finalSteps = updatedSteps.map((s, i) =>
        i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
      );
      return buildReturn(textContent, finalSteps);
    }

    newMessages.push({ role: 'assistant', content: textContent });
    break;
  }

  throw new Error(
    `Watchdog: execution exceeded max tool rounds (${maxToolRounds}) without completion.`,
  );
}
