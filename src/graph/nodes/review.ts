/**
 * Review node: Opus quality gate.
 *
 * Decides: continue (next step) | done | retry (with feedback) | escalate (ask user)
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../../config/model-policy.js';
import { getClient, wrapSystemPrompt } from '../../config/client.js';
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

export async function reviewNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getModelConfig('review');
  const anthropic = getClient();

  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const verPassed = state.verificationResult?.passed ?? false;

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
          state.verificationResult.typecheck_output
            ? `Typecheck:\n${state.verificationResult.typecheck_output.slice(0, 3000)}`
            : '',
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

  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: wrapSystemPrompt(REVIEW_SYSTEM),
    messages: [{ role: 'user', content: reviewPrompt }],
  });

  inputTokens += response.usage.input_tokens;
  outputTokens += response.usage.output_tokens;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

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

  const newMessages: LLMMessage[] = [
    ...state.messages,
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
    tokenUsage: { input: inputTokens, output: outputTokens },
    retryCount: decision === 'retry' ? state.retryCount + 1 : state.retryCount,
    currentStepIndex:
      decision === 'continue'
        ? state.currentStepIndex + 1
        : state.currentStepIndex,
    modelHint: decision === 'continue' ? 'sonnet' : 'opus',
  };
}
