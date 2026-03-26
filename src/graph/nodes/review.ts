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

export async function reviewNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('review', state);

  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const verPassed = state.verificationResult?.passed ?? false;
  const constraints = deriveScopeConstraints(state.instruction);
  const deterministicEditsRequired = shouldRequireEdits(state.instruction);
  const scopeGuard = evaluateScopeGuard(state);
  const failedSteps = state.steps.filter((s) => s.status === 'failed').length;
  const explicitSingleTarget =
    constraints.strictSingleFile && constraints.explicitFiles.length === 1;
  const validatedNoOp = looksLikeValidatedNoOp(state);
  const touchedExplicitTarget =
    explicitSingleTarget &&
    state.fileEdits.some((edit) =>
      pathMatchesAny(edit.file_path, constraints.explicitFiles),
    );
  const deterministicRetry = (feedback: string): Partial<ShipyardStateType> => {
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
    return {
      phase: 'planning',
      reviewDecision: 'retry',
      reviewFeedback: feedback,
      messages: [
        ...state.messages,
        { role: 'assistant', content: `[Review] retry: ${feedback}` },
      ],
      retryCount: state.retryCount + 1,
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
  if (!verPassed && state.fileEdits.length > 0) {
    return deterministicRetry('Verification failed after edits; fix verification errors before completion.');
  }

  if (failedSteps > 0) {
    return deterministicRetry(`Execution marked ${failedSteps} failed step(s). Replan and complete unfinished work.`);
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
          `Errors: ${state.verificationResult.error_count}`,
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
    const jsonMatch = text.match(/\{[\s\S]*"decision"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        decision: string;
        feedback?: string;
      };
      if (['continue', 'done', 'retry', 'escalate'].includes(parsed.decision)) {
        decision = parsed.decision as ReviewDecision;
      }
      feedback = parsed.feedback ?? null;
    }
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
    modelHint: decision === 'continue' ? 'sonnet' : 'opus',
  };
}
