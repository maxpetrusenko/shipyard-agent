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
import { getBaselineFingerprint } from '../../runtime/run-baselines.js';
import {
  deriveDiscoveryCallLimit,
  deriveFirstEditDeadlineMs,
  evaluateCandidateEditPath,
  isDiscoveryToolName,
} from '../guards.js';
import { checkBlastRadius } from '../../tools/blast-radius.js';
import { runBash } from '../../tools/bash.js';
import {
  buildAmbiguousEditRecoveryNudge,
  createExecutionIssue,
  decideNoEditProgressAction,
  deriveBlockerCode,
  deriveBlockingReasonFromToolResult,
  formatExecuteWatchdogError,
  resolveEditsInCurrentExecuteStep,
  shouldTreatCompletionAsNoEdit,
  shouldFastTrackNoEditStall,
  type ExecuteProgressDiagnostics,
} from './execute-progress.js';
import {
  buildContextBlock,
  RETRYABLE_BLOCKER_CODES,
  type ShipyardStateType,
  type ExecutionIssue,
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
- If repo reads + bash output are not enough to unblock an exact error, use web_search with the exact error text before guessing
- Make one logical change at a time
- If converting an existing file into a wrapper, shim, or pure re-export, replace the entire file contents; do not prepend a new export onto the old implementation
- If a file should only re-export another module, the final file must contain only the wrapper/re-export code plus any required header comments
- Process ALL files listed for this step, not just the first one
- Do NOT run full repo verification commands (pnpm test, pnpm type-check); pipeline handles verification after execution
- When done with this step, say "STEP_COMPLETE" in your response
- Do NOT say STEP_COMPLETE until you have addressed every file in the step's file list
- If the step mentions multiple files, you must edit/verify each one before completing
- If the instruction names explicit target files, treat them as hard scope. Do not edit files outside that explicit target list.
- If the explicit target already satisfies the request, report a no-op and complete without editing other files.
- If repeated discovery proves a conditional target does not exist, respond with "NO_EDIT_JUSTIFIED: <reason>" and then "STEP_COMPLETE".
- Never call commit_and_open_pr unless the user explicitly asked for commit, push, or PR behavior.

Shared file safety (CRITICAL):
- Before editing any .ts file, consider: is this file imported by many others?
- NEVER remove or rename exported symbols from widely-imported files (auth.ts, visibility.ts, types.ts, index.ts, utils.ts, config.ts, middleware.ts).
- For such "hub files", use the adapter/re-export pattern: create a new file, update the hub to re-export.
- NEVER use write_file to completely rewrite a shared file. Use surgical edit_file with exact old_string/new_string.
- If an edit_file is reverted by the system, it means the edit caused cascade type errors. Try a different approach.

Codebase conventions:
- This codebase uses TypeScript with moduleResolution "node16". ALL imports MUST include the .js extension (e.g. import { foo } from './bar.js'), even for .ts source files.
- Use vitest for testing.`;

// Scale no-edit stall detection with plan complexity: complex multi-step plans
// need more exploration time. Base=10, +2 per step (max 20).
function deriveMaxNoEditToolRounds(stepCount: number): number {
  return Math.min(20, 10 + Math.max(0, stepCount - 1) * 2);
}
const MAX_FORCED_EDIT_NUDGES = 2;
const EXECUTE_COMPACTION_MAX_CHARS = 100_000;
const MAX_IDENTICAL_TOOL_CALL_REPEATS = 3;

/** Cap tool call history to prevent unbounded memory growth in long sessions.
 *  Keeps the most recent MAX_TOOL_HISTORY entries; drops oldest. */
export const MAX_TOOL_HISTORY = 500;
export function capToolHistory<T>(history: T[]): T[] {
  return history.length > MAX_TOOL_HISTORY
    ? history.slice(-MAX_TOOL_HISTORY)
    : history;
}

function stableSerializeToolInput(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerializeToolInput(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerializeToolInput(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function summarizeToolLoopInput(input: Record<string, unknown>): string {
  const filePath = input['file_path'];
  if (typeof filePath === 'string' && filePath.trim()) return filePath;
  const command = input['command'];
  if (typeof command === 'string' && command.trim()) return command.slice(0, 120);
  return stableSerializeToolInput(input).slice(0, 120);
}

const READ_BACKED_NOOP_STOP_WORDS = new Set([
  'implement', 'implemented', 'update', 'updated', 'ensure', 'ensures', 'full',
  'behavior', 'module', 'routes', 'route', 'surface', 'complete', 'required',
  'specified', 'standardized', 'response', 'responses', 'request', 'current',
  'step', 'hub', 'file', 'files', 'using', 'used', 'align', 'harden', 'review',
  'validate', 'support', 'with', 'from', 'into',
  'that', 'this', 'they', 'them', 'their', 'your', 'while', 'after', 'before',
  'without', 'under', 'also', 'then', 'than', 'there', 'already', 'keep',
  'keeps', 'preserve', 'preserving', 'stable', 'centralized', 'shape'
]);

function normalizeEvidenceToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function extractReadBackedKeywords(stepDescription: string): string[] {
  const raw = stepDescription.match(/[A-Za-z_][A-Za-z0-9_-]{3,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    const candidates = new Set<string>();
    const normalized = normalizeEvidenceToken(token);
    if (normalized) candidates.add(normalized);
    const expanded = token
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .split(/\s+/)
      .map((part) => normalizeEvidenceToken(part))
      .filter(Boolean);
    for (const part of expanded) candidates.add(part);
    for (const candidate of candidates) {
      if (candidate.length < 4) continue;
      if (READ_BACKED_NOOP_STOP_WORDS.has(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out.slice(0, 24);
}

function hasReadBackedStepSatisfaction(params: {
  stepDescription: string;
  stepFiles: string[];
  readCache: Map<string, Record<string, unknown>>;
}): boolean {
  if (params.stepFiles.length === 0 || params.stepFiles.length > 3) return false;
  const chunks: string[] = [];
  for (const filePath of params.stepFiles) {
    for (const [cacheKey, result] of params.readCache.entries()) {
      if (!cacheKey.startsWith(`${filePath}:`)) continue;
      const content = result['content'];
      if (typeof content === 'string' && content.trim()) chunks.push(content.toLowerCase());
    }
  }
  const combined = chunks.join('\n');
  if (!combined) return false;
  const keywords = extractReadBackedKeywords(params.stepDescription);
  if (keywords.length < 3) return false;
  const matches = keywords.filter((token) => combined.includes(token));
  const minMatches = Math.min(6, Math.max(3, Math.ceil(keywords.length / 3)));
  return matches.length >= minMatches;
}

export function detectRepeatedToolCallLoop(
  history: ToolCallRecord[],
  repeatCount = MAX_IDENTICAL_TOOL_CALL_REPEATS,
): string | null {
  if (history.length < repeatCount) return null;
  const recent = history.slice(-repeatCount);
  const first = recent[0];
  if (!first) return null;
  const fingerprint = `${first.tool_name}:${stableSerializeToolInput(first.tool_input)}`;
  const identical = recent.every((entry) =>
    `${entry.tool_name}:${stableSerializeToolInput(entry.tool_input)}` === fingerprint,
  );
  if (!identical) return null;
  const target = summarizeToolLoopInput(first.tool_input);
  return `Watchdog: repeated identical tool call loop detected (${first.tool_name} ×${repeatCount}${target ? ` on ${target}` : ''}). Switch strategy instead of repeating the same call.`;
}

export async function executeNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('coding', state);

  const currentStep = state.steps[state.currentStepIndex];
  if (!currentStep) {
    // All steps complete — advance to verifying instead of erroring.
    // This happens when review's "continue" advances past the last step.
    if (state.currentStepIndex >= state.steps.length && state.steps.length > 0) {
      return {
        phase: 'verifying',
        currentStepIndex: state.steps.length - 1,
      };
    }
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
  const newHistory: ToolCallRecord[] = [...capToolHistory(state.toolCallHistory)];
  const newMessages: LLMMessage[] = [...state.messages];
  // Scale tool rounds with step count: complex plans need more rounds per step.
  // Base 25, +2 per step beyond 5, capped at 40.
  const maxToolRounds = Math.min(40, 25 + Math.max(0, state.steps.length - 5) * 2);
  const maxNoEditRounds = deriveMaxNoEditToolRounds(state.steps.length);
  const stepEditBaseline =
    typeof state.currentStepEditBaseline === 'number'
      ? state.currentStepEditBaseline
      : state.fileEdits.length;
  const stepStartsWithEdits =
    resolveEditsInCurrentExecuteStep({
      totalFileEdits: state.fileEdits.length,
      currentStepEditBaseline: stepEditBaseline,
    }) > 0;

  // Wait for the background verification fingerprint to complete before
  // modifying any files, so the baseline reflects the true pre-edit state.
  await Promise.race([
    getBaselineFingerprint(state.runId),
    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Baseline fingerprint timeout (60s)')), 60_000)),
  ]).catch(() => null);

  const hooks = createRecordingHooks(newEdits, newHistory);
  const overlay = new FileOverlay();
  const readCache = new Map<string, Record<string, unknown>>();
  const READ_CACHE_MAX = 50;
  const discoveryCallLimit = deriveDiscoveryCallLimit(state.instruction);
  const firstEditDeadlineMs = deriveFirstEditDeadlineMs(state.instruction);
  const firstEditWindowStart = stepStartsWithEdits ? null : Date.now();
  let discoveryCallsBeforeFirstEdit = 0;
  let guardrailViolation: string | null = null;
  let repeatedToolLoopMessage: string | null = null;
  let lastBlockingReason: string | null = null;
  /** Track last failing edit_file params for enhanced ambiguous edit recovery. */
  let lastFailingEditPath: string | null = null;
  let lastFailingEditOldString: string | null = null;
  let forcedEditNudges = 0;
  let noEditToolRounds = 0;

  const snapshotExecuteDiagnostics = (
    stopReason: ExecuteProgressDiagnostics['stopReason'],
  ): ExecuteProgressDiagnostics => ({
    noEditToolRounds,
    discoveryCallsBeforeFirstEdit,
    lastBlockingReason,
    stopReason,
  });

  const dispatchWithGuards = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const hasCurrentStepEdits =
      resolveEditsInCurrentExecuteStep({
        totalFileEdits: newEdits.length,
        currentStepEditBaseline: stepEditBaseline,
      }) > 0;
    if (
      !hasCurrentStepEdits &&
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
    if (!hasCurrentStepEdits && isDiscoveryToolName(name)) {
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

        // Blast radius guard: prevent edits that remove exports from hub files
        if (name === 'edit_file' && /\.(ts|tsx)$/.test(candidatePath)) {
          const oldStr = typeof input['old_string'] === 'string' ? input['old_string'] : '';
          const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : '';
          if (oldStr) {
            const blastCheck = await checkBlastRadius({
              filePath: candidatePath,
              oldString: oldStr,
              newString: newStr,
              workDir: WORK_DIR,
            });
            if (!blastCheck.allowed) {
              lastBlockingReason = blastCheck.message;
              return { success: false, message: blastCheck.message ?? 'Blast radius guard blocked this edit.' };
            }
          }
        }
      }
    }

    // Read cache: serve repeated read_file calls from cache
    if (name === 'read_file') {
      const cacheKey = `${input['file_path'] ?? ''}:${input['offset'] ?? ''}:${input['limit'] ?? ''}`;
      const cached = readCache.get(cacheKey);
      if (cached) return cached;
    }

    // Invalidate read cache when a file is written/edited
    if (name === 'edit_file' || name === 'write_file') {
      const editPath = String(input['file_path'] ?? '');
      for (const key of readCache.keys()) {
        if (key.startsWith(`${editPath}:`)) {
          readCache.delete(key);
        }
      }
    }

    const result = await dispatchTool(name, input, hooks, overlay);

    // Cache successful read_file results
    if (name === 'read_file' && result['success'] !== false) {
      const cacheKey = `${input['file_path'] ?? ''}:${input['offset'] ?? ''}:${input['limit'] ?? ''}`;
      if (readCache.size >= READ_CACHE_MAX) {
        // LRU eviction: delete oldest entry
        const oldest = readCache.keys().next().value;
        if (oldest !== undefined) readCache.delete(oldest);
      }
      readCache.set(cacheKey, result);
    }

    // Per-edit incremental typecheck: catch cascade errors after each file mutation.
    // Only runs when baseline is available (otherwise can't distinguish new vs pre-existing errors).
    if (
      (name === 'edit_file' || name === 'write_file') &&
      result['success'] === true &&
      typeof input['file_path'] === 'string' &&
      /\.(ts|tsx)$/.test(input['file_path'] as string)
    ) {
      const PER_EDIT_ERROR_THRESHOLD = 5;
      const baseline = await Promise.race([
        getBaselineFingerprint(state.runId),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Baseline fingerprint timeout (60s)')), 60_000)),
      ]).catch(() => null);
      // Skip per-edit typecheck if no baseline — large projects may have hundreds of
      // pre-existing errors that would false-positive without baseline comparison.
      if (baseline) {
        // Use the project's pnpm type-check (per-package) rather than bare npx tsc
        // which may use a root tsconfig that includes all packages in a monorepo.
        const quickTsc = await runBash({
          command: 'pnpm type-check 2>&1',
          timeout: 120_000,
          cwd: WORK_DIR,
        });
        if (!quickTsc.success) {
          const tscOutput = quickTsc.stdout + quickTsc.stderr;
          const errorLines = tscOutput.split('\n').filter((l: string) => l.includes('error TS'));
          const baselineSet = new Set(baseline.errorLines);
          const newErrors = errorLines.filter((e: string) => !baselineSet.has(e.trim()));

          if (newErrors.length > PER_EDIT_ERROR_THRESHOLD) {
            // Rollback THIS specific file immediately
            const filePath = input['file_path'] as string;
            try {
              await overlay.rollbackFile(filePath);
            } catch (rollbackErr) {
              console.warn(`[execute] rollbackFile failed for ${filePath}:`, rollbackErr);
            }
            const msg = `Per-edit typecheck: reverted ${filePath} — introduced ${newErrors.length} new TS errors. Use a different approach (adapter/re-export pattern for hub files).`;
            lastBlockingReason = msg;
            return { success: false, message: msg, reverted: true, newErrorCount: newErrors.length };
          }
        }
      }
    }

    const blockingReason = deriveBlockingReasonFromToolResult(name, result);
    if (blockingReason) {
      lastBlockingReason = blockingReason;
      // Track failing edit params for enhanced ambiguous edit recovery
      if (name === 'edit_file') {
        lastFailingEditPath = typeof input['file_path'] === 'string' ? input['file_path'] : null;
        lastFailingEditOldString = typeof input['old_string'] === 'string' ? input['old_string'] : null;
      }
    } else if (
      (name === 'edit_file' || name === 'write_file') &&
      result['success'] === true
    ) {
      lastBlockingReason = null;
      lastFailingEditPath = null;
      lastFailingEditOldString = null;
    }
    const repeatedToolLoop = detectRepeatedToolCallLoop(newHistory);
    if (repeatedToolLoop) {
      repeatedToolLoopMessage = repeatedToolLoop;
      lastBlockingReason = repeatedToolLoop;
      return { success: false, message: repeatedToolLoop };
    }
    return result;
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
    const editsInCurrentExecuteStep = resolveEditsInCurrentExecuteStep({
      totalFileEdits: newEdits.length,
      currentStepEditBaseline: stepEditBaseline,
    });
    if (
      shouldTreatCompletionAsNoEdit({
        completionSignaled: isExplicitComplete || isEndTurnNoTools,
        assistantText: fullText,
        editsInCurrentExecuteStep,
      })
    ) {
      lastBlockingReason =
        'STEP_COMPLETE without any successful edit or NO_EDIT_JUSTIFIED evidence';
      newMessages.push({ role: 'assistant', content: fullText });
      messages.push({ role: 'assistant', content: response.content });
      noEditToolRounds += 1;
      if (
        shouldFastTrackNoEditStall({
          noEditToolRounds,
          lastBlockingReason,
        })
      ) {
        noEditToolRounds = maxNoEditRounds;
      }
      // Resolve file content for ambiguous-edit recovery nudge
      let failingEditFileContent: string | null = null;
      if (lastFailingEditPath) {
        for (const [cacheKey, cached] of readCache.entries()) {
          if (cacheKey.startsWith(`${lastFailingEditPath}:`)) {
            const content = cached['content'];
            if (typeof content === 'string') { failingEditFileContent = content; break; }
          }
        }
      }
      const action = decideNoEditProgressAction({
        noEditToolRounds,
        maxNoEditToolRounds: maxNoEditRounds,
        forcedEditNudges,
        maxForcedEditNudges: MAX_FORCED_EDIT_NUDGES,
        editsInCurrentExecuteStep,
        discoveryCallsBeforeFirstEdit,
        discoveryCallLimit,
        stepDescription: currentStep.description,
        stepFiles: currentStep.files,
        assistantText: fullText,
        readBackedSatisfied: hasReadBackedStepSatisfaction({
          stepDescription: currentStep.description,
          stepFiles: currentStep.files,
          readCache,
        }),
        lastBlockingReason,
        lastFailingEditFilePath: lastFailingEditPath,
        lastFailingEditOldString,
        lastFailingEditFileContent: failingEditFileContent,
      });
      if (action.kind === 'nudge') {
        forcedEditNudges += 1;
        noEditToolRounds = 0;
        messages.push({ role: 'user', content: action.nudgeMessage });
        newMessages.push({
          role: 'assistant',
          content:
            `[Watchdog] Rejected empty completion ${forcedEditNudges}/${MAX_FORCED_EDIT_NUDGES}: step still requires a concrete edit or justified no-op.`,
        });
        continue;
      }
      if (action.kind === 'validated_noop') {
        newMessages.push({
          role: 'assistant',
          content: `NO_EDIT_JUSTIFIED: ${action.reason}\nSTEP_COMPLETE`,
        });
        const finalSteps = updatedSteps.map((s, i) =>
          i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
        );
        const snapshotJson = overlay.dirty
          ? overlay.serialize()
          : state.fileOverlaySnapshots ?? null;
        return {
          phase: 'verifying',
          steps: finalSteps,
          fileEdits: newEdits,
          toolCallHistory: newHistory,
          messages: newMessages,
          tokenUsage: tokens.snapshot(),
          fileOverlaySnapshots: snapshotJson,
          executeDiagnostics: action.diagnostics,
        };
      }
      if (action.kind === 'stall') {
        const earlyBlockerCode = deriveBlockerCode(lastBlockingReason);
        const issue = createExecutionIssue({
          kind: 'watchdog',
          message: formatExecuteWatchdogError(action.diagnostics, action.nextAction),
          nextAction: action.nextAction,
          stopReason: 'stalled_no_edit_rounds',
          blockerCode: earlyBlockerCode,
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
          tokenUsage: tokens.snapshot(),
          fileOverlaySnapshots: snapshotJson,
          executeDiagnostics: action.diagnostics,
          executionIssue: issue,
        };
      }
    }
    if (isExplicitComplete || isEndTurnNoTools) {
      newMessages.push({ role: 'assistant', content: fullText });

      // Mark step done
      const finalSteps = updatedSteps.map((s, i) =>
        i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
      );

      // Serialize overlay snapshots for rollback on retry
      const snapshotJson = overlay.dirty
        ? overlay.serialize()
        : state.fileOverlaySnapshots ?? null;

      return {
        phase: 'verifying',
        steps: finalSteps,
        fileEdits: newEdits,
        toolCallHistory: newHistory,
        messages: newMessages,
        tokenUsage: tokens.snapshot(),
        fileOverlaySnapshots: snapshotJson,
        executeDiagnostics: snapshotExecuteDiagnostics('step_complete'),
        // Reset retry counter after successful step completion so later steps
        // get the full retry budget — prevents early exhaustion on long plans.
        retryCount: 0,
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
          tokenUsage: tokens.snapshot(),
          fileOverlaySnapshots: snapshotJson,
          executeDiagnostics: snapshotExecuteDiagnostics('guardrail_violation'),
          executionIssue: issue,
        };
      }

      if (repeatedToolLoopMessage) {
        const nextAction = 'Switch strategy now: stop repeating the same tool call, make one concrete in-scope edit, or justify a no-op.';
        const issue = createExecutionIssue({
          kind: 'watchdog',
          message: formatExecuteWatchdogError(
            snapshotExecuteDiagnostics('stalled_no_edit_rounds'),
            nextAction,
          ),
          nextAction,
          stopReason: 'stalled_no_edit_rounds',
          blockerCode: 'repeated_tool_loop',
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
          tokenUsage: tokens.snapshot(),
          fileOverlaySnapshots: snapshotJson,
          executeDiagnostics: snapshotExecuteDiagnostics('stalled_no_edit_rounds'),
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
        // Ambiguous edits get extra nudges (4 instead of 2) because the
        // enhanced nudge with match locations often resolves the issue.
        const currentBlockerCode = deriveBlockerCode(lastBlockingReason);
        const effectiveMaxNudges = RETRYABLE_BLOCKER_CODES.has(currentBlockerCode) && currentBlockerCode === 'ambiguous_edit'
          ? MAX_FORCED_EDIT_NUDGES + 2  // 4 total for ambiguous edits
          : MAX_FORCED_EDIT_NUDGES;
        // Resolve file content for ambiguous-edit recovery
        let failingContent: string | null = null;
        if (lastFailingEditPath) {
          for (const [cacheKey, cached] of readCache.entries()) {
            if (cacheKey.startsWith(`${lastFailingEditPath}:`)) {
              const content = cached['content'];
              if (typeof content === 'string') { failingContent = content; break; }
            }
          }
        }
        const action = decideNoEditProgressAction({
          noEditToolRounds,
          maxNoEditToolRounds: maxNoEditRounds,
          forcedEditNudges,
          maxForcedEditNudges: effectiveMaxNudges,
          editsInCurrentExecuteStep: resolveEditsInCurrentExecuteStep({
            totalFileEdits: newEdits.length,
            currentStepEditBaseline: stepEditBaseline,
          }),
          discoveryCallsBeforeFirstEdit,
          discoveryCallLimit,
          stepDescription: currentStep.description,
          stepFiles: currentStep.files,
          readBackedSatisfied: hasReadBackedStepSatisfaction({
            stepDescription: currentStep.description,
            stepFiles: currentStep.files,
            readCache,
          }),
          lastBlockingReason,
          lastFailingEditFilePath: lastFailingEditPath,
          lastFailingEditOldString,
          lastFailingEditFileContent: failingContent,
        });
        if (action.kind === 'nudge') {
          forcedEditNudges += 1;
          noEditToolRounds = 0;

          messages.push({
            role: 'user',
            content: action.nudgeMessage,
          });
          newMessages.push({
            role: 'assistant',
            content:
              `[Watchdog] Recovery nudge ${forcedEditNudges}/${effectiveMaxNudges}: forcing one concrete edit attempt now.`,
          });
          continue;
        }
        if (action.kind === 'validated_noop') {
          newMessages.push({
            role: 'assistant',
            content: `NO_EDIT_JUSTIFIED: ${action.reason}\nSTEP_COMPLETE`,
          });

          const finalSteps = updatedSteps.map((s, i) =>
            i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
          );
          const snapshotJson = overlay.dirty
            ? overlay.serialize()
            : state.fileOverlaySnapshots ?? null;

          return {
            phase: 'verifying',
            steps: finalSteps,
            fileEdits: newEdits,
            toolCallHistory: newHistory,
            messages: newMessages,
            tokenUsage: tokens.snapshot(),
            fileOverlaySnapshots: snapshotJson,
            executeDiagnostics: action.diagnostics,
            // Intentionally NOT resetting retryCount here: a validated no-op
            // didn't perform any real work, so it shouldn't earn a fresh retry
            // budget. The counter carries forward so persistent no-ops
            // eventually exhaust retries and stop the run.
          };
        }
        if (action.kind === 'stall') {
          const issue = createExecutionIssue({
            kind: 'watchdog',
            message: formatExecuteWatchdogError(action.diagnostics, action.nextAction),
            nextAction: action.nextAction,
            stopReason: 'stalled_no_edit_rounds',
            blockerCode: currentBlockerCode,
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
            tokenUsage: tokens.snapshot(),
            fileOverlaySnapshots: snapshotJson,
            executeDiagnostics: action.diagnostics,
            executionIssue: issue,
          };
        }
      }
    } else {
      // No tools, not complete — something's wrong
      newMessages.push({ role: 'assistant', content: fullText });
      break;
    }
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
    tokenUsage: tokens.snapshot(),
    fileOverlaySnapshots: snapshotJson,
    executeDiagnostics: snapshotExecuteDiagnostics('max_tool_rounds'),
    executionIssue: issue,
  };
}
