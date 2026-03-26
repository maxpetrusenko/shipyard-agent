/**
 * Execute node: Sonnet executes the current step via tool calls.
 *
 * The LLM gets the current step description and uses tools to implement it.
 * Tool calls are recorded via hooks; file overlay enables rollback.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getResolvedModelConfigFromState,
  isOpenAiModelId,
} from '../../config/model-policy.js';
import {
  getClient,
  wrapSystemPrompt,
  withCachedTools,
} from '../../config/client.js';
import { WORK_DIR } from '../../config/work-dir.js';
import { runOpenAiExecuteLoop } from './execute-openai.js';
import { messagesCreate } from '../../config/messages-create.js';
import {
  dispatchAnthropicToolBlocks,
  stripToolResultCacheControls,
} from '../../llm/anthropic-tool-dispatch.js';
import { compactAnthropicMessages } from '../../llm/message-compaction.js';
import {
  extractTextFromContentBlocks,
  extractToolUseBlocks,
} from '../../llm/anthropic-parse.js';
import { TokenAccumulator } from '../../llm/token-usage.js';
import {
  dispatchTool,
  getExecutionToolSchemas,
} from '../../tools/index.js';
import { createRecordingHooks } from '../../tools/hooks.js';
import { FileOverlay } from '../../tools/file-overlay.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import {
  deriveDiscoveryCallLimit,
  deriveFirstEditDeadlineMs,
  evaluateCandidateEditPath,
  isDiscoveryToolName,
} from '../guards.js';
import {
  buildContextBlock,
  type ShipyardStateType,
  type FileEdit,
  type ToolCallRecord,
  type LLMMessage,
} from '../state.js';

const EXECUTE_SYSTEM = `You are Shipyard, an autonomous coding agent. You are in the EXECUTION phase.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using tools, always use absolute paths (e.g. ${WORK_DIR}/src/index.ts).
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

You are executing a specific step of a larger plan. Use the available tools to implement the change.

Rules:
- Read files before editing (understand before modifying)
- Use edit_file for surgical changes (preferred over write_file)
- Use write_file only for new files
- Use bash for running commands (build, lint, format) — always cd to ${WORK_DIR} first
- Make one logical change at a time
- Process ALL files listed for this step, not just the first one
- Do NOT run full repo verification commands (pnpm test, pnpm type-check); pipeline handles verification after execution
- When done with this step, say "STEP_COMPLETE" in your response
- Do NOT say STEP_COMPLETE until you have addressed every file in the step's file list
- If the step mentions multiple files, you must edit/verify each one before completing
- If the instruction names explicit target files, treat them as hard scope. Do not edit files outside that explicit target list.
- If the explicit target already satisfies the request, report a no-op and complete without editing other files.
- Never call commit_and_open_pr unless the user explicitly asked for commit, push, or PR behavior.

Codebase conventions:
- This codebase uses TypeScript with moduleResolution "node16". ALL imports MUST include the .js extension (e.g. import { foo } from './bar.js'), even for .ts source files.
- Use vitest for testing.`;

const MAX_NO_EDIT_TOOL_ROUNDS = 8;
const MAX_FORCED_EDIT_NUDGES = 1;
const EXECUTE_COMPACTION_MAX_CHARS = 100_000;

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

export async function executeNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('coding', state);

  const currentStep = state.steps[state.currentStepIndex];
  if (!currentStep) {
    return {
      phase: 'error',
      error: `No step at index ${state.currentStepIndex}`,
    };
  }

  // Build context (separate cache breakpoint from static system prompt)
  const contextBlock = buildContextBlock(state.contexts);

  const contextSection = contextBlock
    ? `# Context\n\n${contextBlock}`
    : undefined;

  const nextSteps = state.steps
    .slice(state.currentStepIndex + 1, state.currentStepIndex + 4)
    .map((s) => `- [${s.status}] ${s.description}`);

  const stepPrompt = [
    `## Current Step (${currentStep.index + 1}/${state.steps.length})`,
    currentStep.description,
    currentStep.files.length > 0
      ? `Files: ${currentStep.files.join(', ')}`
      : '',
    '',
    `Remaining steps after this: ${Math.max(0, state.steps.length - state.currentStepIndex - 1)}`,
    nextSteps.length > 0 ? 'Next steps:\n' + nextSteps.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tokens = new TokenAccumulator({
    input: state.tokenUsage?.input,
    output: state.tokenUsage?.output,
    cacheRead: state.tokenUsage?.cacheRead,
    cacheCreation: state.tokenUsage?.cacheCreation,
  });
  const newEdits: FileEdit[] = [...state.fileEdits];
  const newHistory: ToolCallRecord[] = [...state.toolCallHistory];
  const newMessages: LLMMessage[] = [...state.messages];
  const maxToolRounds = 25;

  const hooks = createRecordingHooks(newEdits, newHistory);
  const overlay = new FileOverlay();
  const discoveryCallLimit = deriveDiscoveryCallLimit(state.instruction);
  const firstEditDeadlineMs = deriveFirstEditDeadlineMs(state.instruction);
  const firstEditWindowStart = state.fileEdits.length === 0 ? Date.now() : null;
  let discoveryCallsBeforeFirstEdit =
    state.fileEdits.length === 0
      ? state.toolCallHistory.filter((t) => isDiscoveryToolName(t.tool_name)).length
      : 0;
  let guardrailViolation: string | null = null;
  let forcedEditNudges = 0;

  const dispatchWithGuards = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const hasEdits = state.fileEdits.length + newEdits.length > 0;
    if (!hasEdits && firstEditWindowStart != null && firstEditDeadlineMs != null) {
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
  };

  const updatedSteps = state.steps.map((s, i) =>
    i === state.currentStepIndex ? { ...s, status: 'in_progress' as const } : s,
  );

  if (isOpenAiModelId(config.model)) {
    const rawSystem = contextBlock
      ? `${EXECUTE_SYSTEM}\n\n# Context\n\n${contextBlock}`
      : EXECUTE_SYSTEM;
    const oa = await runOpenAiExecuteLoop({
      state,
      config,
      system: rawSystem,
      stepPrompt,
      hooks,
      overlay,
      updatedSteps,
    });
    return {
      ...oa,
      tokenUsage: oa.tokenUsage,
    };
  }

  const anthropic = getClient();
  const systemPrompt = wrapSystemPrompt(EXECUTE_SYSTEM, contextSection);

  const cachedTools = withCachedTools(getExecutionToolSchemas(state.instruction));

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: stepPrompt },
  ];
  let noEditToolRounds = 0;

  for (let round = 0; round < maxToolRounds; round++) {
    const liveFollowups = consumeLiveFollowups(state.runId);
    if (liveFollowups.length > 0) {
      messages.push({
        role: 'user',
        content: liveFollowups.join('\n\n'),
      });
      newMessages.push({
        role: 'assistant',
        content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before execution call.`,
      });
    }

    const requestMessages = stripToolResultCacheControls(messages);
    const compacted = compactAnthropicMessages(requestMessages, {
      maxChars: EXECUTE_COMPACTION_MAX_CHARS,
      preserveRecentMessages: 10,
    });
    if (compacted.compacted) {
      newMessages.push({
        role: 'assistant',
        content:
          `[Compaction] execution history compacted (${compacted.beforeChars} -> ${compacted.afterChars} chars, dropped ${compacted.droppedMessages} messages).`,
      });
    }
    const response = await messagesCreate(anthropic, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      tools: cachedTools,
      messages: compacted.messages,
    }, {
      liveNode: 'execute',
      traceName: 'execute',
      traceMetadata: { node: 'execute', provider: 'anthropic', model: config.model },
      traceTags: ['shipyard', 'execute', 'anthropic'],
    });

    tokens.addAnthropicRound(response);

    const fullText = extractTextFromContentBlocks(response.content);
    const toolBlocks = extractToolUseBlocks(response.content);

    // Check if step is complete:
    // - Explicit STEP_COMPLETE signal always means done
    // - end_turn without tool calls means the model has nothing left to do
    // - end_turn WITH tool calls in previous rounds but not this one = likely done
    const isExplicitComplete = fullText.includes('STEP_COMPLETE');
    const isEndTurnNoTools = response.stop_reason === 'end_turn' && toolBlocks.length === 0;
    if (isExplicitComplete || isEndTurnNoTools) {
      newMessages.push({ role: 'assistant', content: fullText });

      // Mark step done
      const finalSteps = updatedSteps.map((s, i) =>
        i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
      );

      // Serialize overlay snapshots for rollback on retry
      const snapshotJson = overlay.dirty
        ? JSON.stringify(Object.fromEntries(
            overlay.trackedFiles().map((f) => [f, ''] /* paths only; content in overlay */),
          ))
        : state.fileOverlaySnapshots ?? null;

      return {
        phase: 'verifying',
        steps: finalSteps,
        fileEdits: newEdits,
        toolCallHistory: newHistory,
        messages: newMessages,
        tokenUsage: tokens.snapshot(),
        fileOverlaySnapshots: snapshotJson,
      };
    }

    // Execute tool calls (hooks handle recording, overlay handles snapshots)
    if (toolBlocks.length > 0) {
      const editsBefore = newEdits.length;
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = await dispatchAnthropicToolBlocks(
        toolBlocks,
        dispatchWithGuards,
      );
      messages.push({ role: 'user', content: toolResults });
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
          messages.push({
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
    } else {
      // No tools, not complete — something's wrong
      newMessages.push({ role: 'assistant', content: fullText });
      break;
    }
  }

  throw new Error(`Watchdog: execution exceeded max tool rounds (${maxToolRounds}) without completion.`);
}
