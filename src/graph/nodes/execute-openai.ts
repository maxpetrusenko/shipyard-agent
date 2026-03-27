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
import {
  createExecutionIssue,
  decideNoEditProgressAction,
  deriveBlockingReasonFromToolResult,
  formatExecuteWatchdogError,
  shouldFastTrackNoEditStall,
  type ExecuteProgressDiagnostics,
} from './execute-progress.js';
import type {
  ShipyardStateType,
  ExecutionIssue,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
} from '../state.js';

function deriveMaxNoEditToolRounds(stepCount: number): number {
  return Math.min(20, 10 + Math.max(0, stepCount - 1) * 2);
}
const MAX_FORCED_EDIT_NUDGES = 2;
const EXECUTE_OPENAI_COMPACTION_MAX_CHARS = 100_000;

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
  // Scale tool rounds with step count: complex plans need more rounds per step.
  // Base 25, +2 per step beyond 5, capped at 40.
  const maxToolRounds = Math.min(40, 25 + Math.max(0, state.steps.length - 5) * 2);
  const maxNoEditRounds = deriveMaxNoEditToolRounds(state.steps.length);
  const stepEditBaseline = state.fileEdits.length;
  const currentStepDescription =
    state.steps[state.currentStepIndex]?.description ?? stepPrompt;
  let noEditToolRounds = 0;
  const discoveryCallLimit = deriveDiscoveryCallLimit(state.instruction);
  const firstEditDeadlineMs = deriveFirstEditDeadlineMs(state.instruction);
  const firstEditWindowStart = state.fileEdits.length === 0 ? Date.now() : null;
  let discoveryCallsBeforeFirstEdit =
    state.fileEdits.length === 0
      ? state.toolCallHistory.filter((t) => isDiscoveryToolName(t.tool_name)).length
      : 0;
  let guardrailViolation: string | null = null;
  let lastBlockingReason: string | null = null;
  let forcedEditNudges = 0;
  const snapshotExecuteDiagnostics = (
    stopReason: ExecuteProgressDiagnostics['stopReason'],
  ): ExecuteProgressDiagnostics => ({
    noEditToolRounds,
    discoveryCallsBeforeFirstEdit,
    lastBlockingReason,
    stopReason,
  });

  const buildReturn = (
    fullText: string,
    finalSteps: ShipyardStateType['steps'],
    stopReason: ExecuteProgressDiagnostics['stopReason'] = 'step_complete',
  ): Partial<ShipyardStateType> => {
    newMessages.push({ role: 'assistant', content: fullText });
    const snapshotJson = overlay.dirty
      ? overlay.serialize()
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
      executeDiagnostics: snapshotExecuteDiagnostics(stopReason),
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
              lastBlockingReason = guardrailViolation;
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
              lastBlockingReason = guardrailViolation;
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
                lastBlockingReason = guardrailViolation;
                return { success: false, message: guardrailViolation };
              }
            }
          }
          const result = await dispatchTool(name, input, hooks, overlay);
          const blockingReason = deriveBlockingReasonFromToolResult(name, result);
          if (blockingReason) {
            lastBlockingReason = blockingReason;
          } else if (
            (name === 'edit_file' || name === 'write_file') &&
            result['success'] === true
          ) {
            lastBlockingReason = null;
          }
          return result;
        },
        {
          unsupportedToolMessage: 'Unsupported tool call type for Shipyard',
        },
      );
      if (guardrailViolation) {
        const nextAction = `Resolve guardrail blocker and retry one in-scope edit_file call. Blocker: ${guardrailViolation}`;
        const issue = createExecutionIssue({
          kind: 'guardrail',
          message: formatExecuteWatchdogError(
            snapshotExecuteDiagnostics('guardrail_violation'),
            nextAction,
          ),
          nextAction,
          stopReason: 'guardrail_violation',
        });
        const failedSteps = updatedSteps.map((s, i) =>
          i === state.currentStepIndex ? { ...s, status: 'failed' as const } : s,
        );
        const snapshotJson = overlay.dirty
          ? overlay.serialize()
          : state.fileOverlaySnapshots ?? null;
        return {
          phase: 'verifying',
          steps: failedSteps,
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
          executeDiagnostics: snapshotExecuteDiagnostics('guardrail_violation'),
          executionIssue: issue,
        };
      }

      if (newEdits.length === editsBefore) {
        noEditToolRounds += 1;
      } else {
        noEditToolRounds = 0;
      }

      if (
        shouldFastTrackNoEditStall({
          noEditToolRounds,
          lastBlockingReason,
        })
      ) {
        noEditToolRounds = maxNoEditRounds;
      }

      if (noEditToolRounds >= maxNoEditRounds) {
        const action = decideNoEditProgressAction({
          noEditToolRounds,
          maxNoEditToolRounds: maxNoEditRounds,
          forcedEditNudges,
          maxForcedEditNudges: MAX_FORCED_EDIT_NUDGES,
          editsInCurrentExecuteStep: Math.max(0, newEdits.length - stepEditBaseline),
          discoveryCallsBeforeFirstEdit,
          discoveryCallLimit,
          stepDescription: currentStepDescription,
          lastBlockingReason,
        });
        if (action.kind === 'nudge') {
          forcedEditNudges += 1;
          noEditToolRounds = 0;
          conversation.push({
            role: 'user',
            content: action.nudgeMessage,
          });
          newMessages.push({
            role: 'assistant',
            content:
              `[Watchdog] Recovery nudge ${forcedEditNudges}/${MAX_FORCED_EDIT_NUDGES}: forcing one concrete edit attempt now.`,
          });
          continue;
        }
        if (action.kind === 'validated_noop') {
          const finalSteps = updatedSteps.map((s, i) =>
            i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
          );
          return buildReturn(
            `NO_EDIT_JUSTIFIED: ${action.reason}\nSTEP_COMPLETE`,
            finalSteps,
            'validated_noop',
          );
        }
        if (action.kind === 'stall') {
          const issue = createExecutionIssue({
            kind: 'watchdog',
            message: formatExecuteWatchdogError(action.diagnostics, action.nextAction),
            nextAction: action.nextAction,
            stopReason: 'stalled_no_edit_rounds',
          });
          const failedSteps = updatedSteps.map((s, i) =>
            i === state.currentStepIndex ? { ...s, status: 'failed' as const } : s,
          );
          const snapshotJson = overlay.dirty
            ? overlay.serialize()
            : state.fileOverlaySnapshots ?? null;
          return {
            phase: 'verifying',
            steps: failedSteps,
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
            executeDiagnostics: action.diagnostics,
            executionIssue: issue,
          };
        }
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

  const maxRoundMsg = `Execution exceeded max tool rounds (${maxToolRounds}). Either return STEP_COMPLETE with rationale or perform one concrete edit_file call.`;
  const issue = createExecutionIssue({
    kind: 'max_tool_rounds',
    message: formatExecuteWatchdogError(
      snapshotExecuteDiagnostics('max_tool_rounds'),
      maxRoundMsg,
    ),
    nextAction: maxRoundMsg,
    stopReason: 'max_tool_rounds',
  });
  const failedSteps = updatedSteps.map((s, i) =>
    i === state.currentStepIndex ? { ...s, status: 'failed' as const } : s,
  );
  const snapshotJson = overlay.dirty
    ? overlay.serialize()
    : state.fileOverlaySnapshots ?? null;
  return {
    phase: 'verifying',
    steps: failedSteps,
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
    executeDiagnostics: snapshotExecuteDiagnostics('max_tool_rounds'),
    executionIssue: issue,
  };
}
