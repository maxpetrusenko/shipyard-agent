/**
 * Review node: Opus quality gate.
 *
 * Decides: continue (next step) | done | retry (with feedback) | escalate (ask user)
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getResolvedModelConfigFromState,
  isOpenAiModelId,
} from '../../config/model-policy.js';
import { getClient, wrapSystemPrompt } from '../../config/client.js';
import {
  messagesCreate,
  extractCacheMetrics,
} from '../../config/messages-create.js';
import { completeTextForRole } from '../../llm/complete-text.js';
import {
  deriveScopeConstraints,
  evaluateScopeGuard,
  pathMatchesAny,
  shouldRequireEdits,
} from '../guards.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import { traceDecision, traceParser } from '../../runtime/trace-helpers.js';
import { FileOverlay } from '../../tools/file-overlay.js';
import type { ShipyardStateType, ReviewDecision, LLMMessage } from '../state.js';

const REVIEW_SYSTEM = `You are the Shipyard quality reviewer (Opus). You evaluate the work done by the coding agent.

You have full context: the original instruction, the plan, file edits made, and verification results.

## CRITICAL: Check for COMPLETENESS

Your #1 job is ensuring the instruction was FULLY satisfied, not just partially.

Ask yourself:
1. Does the instruction imply a codebase-wide change? (e.g. "enable strict mode", "add X to all files", "rename Y everywhere")
2. If yes: does the number of files edited match the expected scope? If the instruction says "all files" or implies many files, but only 1-3 were edited, that is INCOMPLETE. Choose "retry".
3. Were ALL plan steps executed? If steps remain pending, choose "continue".
4. Did verification pass? If not, choose "retry" with the error details.
5. Are there pre-existing errors? Pre-existing errors (NOT caused by this run) should be IGNORED when deciding. Only NEW errors (introduced by this run) matter. If Passed=true and New errors=0, verification is clean regardless of pre-existing error count.

## Completeness heuristics
- If the instruction contains words like "all", "every", "across the codebase", "everywhere", "each" — the edit count should reflect that breadth.
- If the plan listed N files but only M < N were actually edited, that is suspicious.
- A single-file edit for a codebase-wide instruction is almost always incomplete.

Your decision must be one of:
- "continue": More steps remain in the plan. Move to the next step.
- "done": All steps complete, verification passed, instruction FULLY fulfilled.
- "retry": The work is incomplete or incorrect. Provide specific feedback explaining what was missed and what the planner should do differently.
- "escalate": The issue is ambiguous or beyond automated fixing. Ask the user.

Respond with a JSON object:
{"decision": "done|continue|retry|escalate", "feedback": "explanation if retry/escalate"}`;

function recentAssistantText(state: ShipyardStateType): string {
  return state.messages
    .filter((m) => m.role === 'assistant')
    .slice(-4)
    .map((m) => m.content)
    .join('\n')
    .toLowerCase();
}

function looksLikeValidatedNoOp(state: ShipyardStateType): boolean {
  if (!state.verificationResult?.passed) return false;
  if (state.fileEdits.length !== 0) return false;
  const corpus = [
    state.instruction,
    ...state.steps.map((s) => s.description),
    recentAssistantText(state),
  ]
    .join('\n')
    .toLowerCase();
  return (
    corpus.includes('no changes needed') ||
    corpus.includes('no changes are needed') ||
    corpus.includes('already contains') ||
    corpus.includes('already exists') ||
    corpus.includes('no edit is needed')
  );
}

function looksLikeMissingExplicitTarget(
  state: ShipyardStateType,
  explicitTarget: string,
): boolean {
  const corpus = state.messages
    .filter((m) => m.role === 'assistant')
    .slice(-6)
    .map((m) => m.content.toLowerCase())
    .join('\n');
  if (!corpus.trim()) return false;

  const target = explicitTarget.toLowerCase();
  const basename = target.split('/').filter(Boolean).at(-1) ?? target;
  const mentionsTarget =
    corpus.includes(target) || (basename.length > 0 && corpus.includes(basename));
  if (!mentionsTarget) return false;

  return [
    'file not found',
    'does not exist',
    'not exist in the repository',
    'missing from the repository',
    "couldn’t find",
    "couldn't find",
    'could not find',
    'there were no matches',
    'no matches for',
    'nothing to edit',
  ].some((needle) => corpus.includes(needle));
}

export async function reviewNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('review', state);

  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const verPassed = state.verificationResult?.passed ?? false;
  const constraints = deriveScopeConstraints(state.instruction);
  const deterministicEditsRequired = shouldRequireEdits(state.instruction);
  const scopeGuard = evaluateScopeGuard(state);
  const explicitSingleTarget =
    constraints.strictSingleFile && constraints.explicitFiles.length === 1;
  const validatedNoOp = looksLikeValidatedNoOp(state);
  const touchedExplicitTarget =
    explicitSingleTarget &&
    state.fileEdits.some((edit) =>
      pathMatchesAny(edit.file_path, constraints.explicitFiles),
    );
  const rollbackOverlays = async (): Promise<void> => {
    if (!state.fileOverlaySnapshots) return;
    try {
      const overlay = FileOverlay.deserialize(state.fileOverlaySnapshots);
      await overlay.rollbackAll();
    } catch { /* best-effort */ }
  };
  const deterministicRetry = async (feedback: string): Promise<Partial<ShipyardStateType>> => {
    const wouldExceed = state.retryCount >= state.maxRetries - 1;
    if (wouldExceed) {
      return {
        phase: 'error',
        reviewDecision: 'escalate',
        reviewFeedback: `Max retries (${state.maxRetries}) exceeded. ${feedback}`,
        messages: [
          ...state.messages,
          { role: 'assistant', content: `[Review] escalate: Max retries exceeded. ${feedback}` },
        ],
        modelHint: 'opus',
      };
    }
    // Rollback partial edits before re-planning (mirrors error-recovery.ts:33)
    await rollbackOverlays();

    // Decide retry phase: if verification found errors but we have steps, keep
    // the plan and re-execute (don't waste a retry re-planning from scratch).
    const isVerificationRetry =
      typeof state.verificationResult?.newErrorCount === 'number' &&
      state.verificationResult.newErrorCount > 0 &&
      state.steps.length > 0;
    const retryPhase = isVerificationRetry ? 'executing' as const : 'planning' as const;

    return {
      phase: retryPhase,
      reviewDecision: 'retry',
      reviewFeedback: feedback,
      messages: [
        ...state.messages,
        { role: 'assistant', content: `[Review] retry (${retryPhase}): ${feedback}` },
      ],
      retryCount: state.retryCount + 1,
      executionIssue: null,
      fileOverlaySnapshots: null,
      modelHint: 'opus',
    };
  };
  const deterministicDone = (feedback: string): Partial<ShipyardStateType> => ({
    phase: 'done',
    reviewDecision: 'done',
    reviewFeedback: feedback,
    messages: [
      ...state.messages,
      { role: 'assistant', content: `[Review] done: ${feedback}` },
    ],
    modelHint: 'opus',
  });

  // Deterministic guards before LLM review to avoid false "done".
  const deterministicResult = await traceDecision('deterministic_guards', {
    verPassed,
    failedSteps: state.steps.filter((s) => s.status === 'failed').length,
    scopeGuardOk: scopeGuard.ok,
    hasMoreSteps,
    editCount: state.fileEdits.length,
    retryCount: state.retryCount,
    explicitSingleTarget,
    hasExecutionIssue: Boolean(state.executionIssue?.recoverable),
    newErrorCount: state.verificationResult?.newErrorCount ?? 0,
  }, async (): Promise<Partial<ShipyardStateType> | null> => {
    // ExecutionIssue from execute node (single signal source for soft failures)
    if (state.executionIssue?.recoverable) {
      return deterministicRetry(
        `Execution issue (${state.executionIssue.kind}): ${state.executionIssue.message}`,
      );
    }

    // New errors introduced by this run (baseline-diffed)
    const newErrCount = state.verificationResult?.newErrorCount;

    // Early bail: too many new errors → don't waste retries, escalate immediately.
    // Threshold is generous (80) because a single DB migration or setup failure can
    // cascade across all test suites — inflating newErrorCount well beyond the actual
    // number of root-cause issues.
    if (typeof newErrCount === 'number' && newErrCount > 80) {
      await rollbackOverlays();
      return {
        phase: 'error',
        reviewDecision: 'escalate',
        reviewFeedback: `Too many errors (${newErrCount}) introduced. Escalating instead of retrying.`,
        messages: [
          ...state.messages,
          { role: 'assistant', content: `[Review] escalate: Too many errors (${newErrCount}) introduced. Escalating instead of retrying.` },
        ],
        executionIssue: null,
        fileOverlaySnapshots: null,
        modelHint: 'opus',
      };
    }

    if (typeof newErrCount === 'number' && newErrCount > 0) {
      return deterministicRetry(
        `Verification found ${newErrCount} new error(s) introduced by this run; fix before completion.`,
      );
    }

    if (!verPassed && state.fileEdits.length > 0) {
      return deterministicRetry('Verification failed after edits; fix verification errors before completion.');
    }

    if (!scopeGuard.ok) {
      return deterministicRetry(scopeGuard.reason ?? 'Scope guard failed.');
    }

    if (explicitSingleTarget && verPassed && (touchedExplicitTarget || validatedNoOp)) {
      return deterministicDone(
        touchedExplicitTarget
          ? `Explicit target satisfied: ${constraints.explicitFiles[0]}`
          : `Validated explicit-target no-op: ${constraints.explicitFiles[0]} already satisfied the request.`,
      );
    }

    if (
      explicitSingleTarget &&
      state.fileEdits.length === 0 &&
      looksLikeMissingExplicitTarget(state, constraints.explicitFiles[0]!)
    ) {
      const feedback =
        `Explicit target ${constraints.explicitFiles[0]} is missing after repository search. ` +
        'Ask for the correct path or broaden scope before retrying.';
      return {
        phase: 'error',
        reviewDecision: 'escalate',
        reviewFeedback: feedback,
        error: feedback,
        messages: [
          ...state.messages,
          { role: 'assistant', content: `[Review] escalate: ${feedback}` },
        ],
        modelHint: 'opus',
      };
    }

    if (
      deterministicEditsRequired &&
      state.fileEdits.length === 0 &&
      !validatedNoOp
    ) {
      return deterministicRetry('Instruction required code edits but no file changes were recorded.');
    }

    // Fast path: more steps to do and verification passed — just advance
    if (hasMoreSteps && verPassed) {
      return {
        phase: 'executing',
        currentStepIndex: state.currentStepIndex + 1,
        reviewDecision: 'continue',
        reviewFeedback: null,
        modelHint: 'sonnet',
      };
    }

    // Fast path: all steps done, verification passed with 0 new errors, edits made.
    // No need for LLM review — baseline-diffed verification already confirmed no regressions.
    // This avoids the LLM getting confused by high pre-existing error counts.
    const allStepsDone = state.steps.length > 0 && state.steps.every((s) => s.status === 'done');
    const zeroNewErrors = typeof newErrCount === 'number' && newErrCount === 0;
    if (!hasMoreSteps && verPassed && allStepsDone && zeroNewErrors && state.fileEdits.length > 0) {
      return deterministicDone(
        `All ${state.steps.length} steps completed. Verification passed with 0 new errors ` +
        `(${state.verificationResult?.preExistingErrorCount ?? 0} pre-existing). Work complete.`,
      );
    }

    return null; // Fall through to LLM
  });

  if (deterministicResult) return deterministicResult;

  // NOTE: No fast path for "all done". We ALWAYS run the full Opus review
  // when all steps are complete to verify the instruction was FULLY satisfied.
  // This catches cases where the plan was too narrow (e.g. 1 file edited
  // when the instruction required codebase-wide changes).

  // Need Opus to evaluate
  const reviewPrompt = [
    '## Original Instruction',
    state.instruction,
    '',
    '## Plan Steps',
    ...state.steps.map(
      (s) => `${s.index + 1}. [${s.status}] ${s.description}`,
    ),
    '',
    `## File Edits (${state.fileEdits.length} total)`,
    state.fileEdits.length > 0
      ? state.fileEdits
          .map((e) => `- ${e.file_path} (tier ${e.tier})`)
          .join('\n')
      : 'No edits made.',
    '',
    `## Plan coverage`,
    `Total plan steps: ${state.steps.length}`,
    `Steps completed: ${state.steps.filter((s) => s.status === 'done').length}`,
    `Total unique files in plan: ${[...new Set(state.steps.flatMap((s) => s.files))].length}`,
    `Total unique files actually edited: ${[...new Set(state.fileEdits.map((e) => e.file_path))].length}`,
    '',
    '## Verification',
    state.verificationResult
      ? [
          `Passed: ${state.verificationResult.passed}`,
          `New errors (introduced by this run): ${state.verificationResult.newErrorCount ?? 'unknown'}`,
          `Pre-existing errors (NOT caused by this run): ${state.verificationResult.preExistingErrorCount ?? 0}`,
          `Total errors: ${state.verificationResult.error_count}`,
          !state.verificationResult.passed &&
          state.verificationResult.typecheck_output
            ? `Typecheck:\n${state.verificationResult.typecheck_output.slice(0, 3000)}`
            : '',
          !state.verificationResult.passed &&
          state.verificationResult.test_output
            ? `Tests:\n${state.verificationResult.test_output.slice(0, 3000)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No verification ran.',
    '',
    `## Retry count: ${state.retryCount}/${state.maxRetries}`,
  ].join('\n');
  const liveFollowups = consumeLiveFollowups(state.runId);
  const reviewPromptWithFollowups = liveFollowups.length > 0
    ? `${reviewPrompt}\n\n## Live Follow-ups\n${liveFollowups.join('\n\n')}`
    : reviewPrompt;

  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;
  let cacheReadTokens = state.tokenUsage?.cacheRead ?? 0;
  let cacheCreationTokens = state.tokenUsage?.cacheCreation ?? 0;

  let text: string;
  if (isOpenAiModelId(config.model)) {
    const r = await completeTextForRole(state, 'review', REVIEW_SYSTEM, [
      { role: 'user', content: reviewPromptWithFollowups },
    ], { liveNode: 'review' });
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cacheReadTokens += r.cacheRead;
    cacheCreationTokens += r.cacheCreation;
    text = r.text;
  } else {
    const anthropic = getClient();
    const response = await messagesCreate(anthropic, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: wrapSystemPrompt(REVIEW_SYSTEM),
      messages: [{ role: 'user', content: reviewPromptWithFollowups }],
    }, {
      liveNode: 'review',
      traceName: 'review',
      traceMetadata: { node: 'review', provider: 'anthropic', model: config.model },
      traceTags: ['shipyard', 'review', 'anthropic'],
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    const rcm = extractCacheMetrics(response);
    cacheReadTokens += rcm.cacheRead;
    cacheCreationTokens += rcm.cacheCreation;

    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  // Parse decision
  let decision: ReviewDecision = 'escalate';
  let feedback: string | null = null;

  try {
    const parseResult = await traceParser('review_decision', async () => {
      const jsonMatch = text.match(/\{[\s\S]*"decision"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          decision: string;
          feedback?: string;
        };
        return { decision: parsed.decision, feedback: parsed.feedback ?? null, matched: true };
      }
      return { decision: 'escalate', feedback: null, matched: false };
    }, text);
    if (['continue', 'done', 'retry', 'escalate'].includes(parseResult.decision)) {
      decision = parseResult.decision as ReviewDecision;
    }
    feedback = parseResult.feedback;
  } catch {
    // Parse failed, default to escalate
  }

  // Enforce retry limits (retryCount incremented below; check >= maxRetries - 1)
  if (decision === 'retry' && state.retryCount >= state.maxRetries - 1) {
    decision = 'escalate';
    feedback = `Max retries (${state.maxRetries}) exceeded. ${feedback ?? ''}`;
  }

  // Reviewer can overfit to "edits must exist"; allow validated no-op tasks.
  if (decision === 'retry' && validatedNoOp) {
    decision = 'done';
    feedback = 'Validated no-op task: instruction satisfied without file edits.';
  }

  const newMessages: LLMMessage[] = [
    ...state.messages,
    ...(liveFollowups.length > 0
      ? [{ role: 'assistant', content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before review call.` } as LLMMessage]
      : []),
    { role: 'assistant', content: `[Review] ${decision}: ${feedback ?? 'OK'}` },
  ];

  // Map decision to next phase
  const phaseMap: Record<ReviewDecision, ShipyardStateType['phase']> = {
    continue: 'executing',
    done: 'done',
    retry: 'planning',
    escalate: 'error',
  };

  // Rollback partial edits before re-planning (same as deterministicRetry path)
  if (decision === 'retry') await rollbackOverlays();

  return {
    phase: phaseMap[decision],
    reviewDecision: decision,
    reviewFeedback: feedback,
    messages: newMessages,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheCreation: cacheCreationTokens,
    },
    retryCount: decision === 'retry' ? state.retryCount + 1 : state.retryCount,
    currentStepIndex:
      decision === 'continue'
        ? state.currentStepIndex + 1
        : state.currentStepIndex,
    fileOverlaySnapshots: decision === 'retry' ? null : undefined,
    executionIssue: decision === 'retry' ? null : undefined,
    modelHint: decision === 'continue' ? 'sonnet' : 'opus',
  };
}
