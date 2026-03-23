/**
 * Review node: Opus quality gate.
 *
 * Decides: continue (next step) | done | retry (with feedback) | escalate (ask user)
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../../config/model-policy.js';
import type { ShipyardStateType, ReviewDecision, LLMMessage } from '../state.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const REVIEW_SYSTEM = `You are the Shipyard quality reviewer (Opus). You evaluate the work done by the coding agent.

You have full context: the original instruction, the plan, file edits made, and verification results.

Your decision must be one of:
- "continue": More steps remain in the plan. Move to the next step.
- "done": All steps complete, verification passed, instruction fulfilled.
- "retry": Something is wrong. Provide specific feedback for the planner to fix.
- "escalate": The issue is ambiguous or beyond automated fixing. Ask the user.

Respond with a JSON object:
{"decision": "done|continue|retry|escalate", "feedback": "explanation if retry/escalate"}`;

export async function reviewNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getModelConfig('review');
  const anthropic = getClient();

  const allStepsDone = state.steps.every((s) => s.status === 'done');
  const hasMoreSteps = state.currentStepIndex < state.steps.length - 1;
  const verPassed = state.verificationResult?.passed ?? false;

  // Fast path: more steps to do and verification passed
  if (hasMoreSteps && verPassed) {
    return {
      phase: 'executing',
      currentStepIndex: state.currentStepIndex + 1,
      reviewDecision: 'continue',
      reviewFeedback: null,
      modelHint: 'sonnet',
    };
  }

  // Fast path: all done and passed
  if (allStepsDone && verPassed) {
    return {
      phase: 'done',
      reviewDecision: 'done',
      reviewFeedback: null,
    };
  }

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
    '## File Edits',
    state.fileEdits.length > 0
      ? state.fileEdits
          .map((e) => `- ${e.file_path} (tier ${e.tier})`)
          .join('\n')
      : 'No edits made.',
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
    system: REVIEW_SYSTEM,
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

  // Enforce retry limits
  if (decision === 'retry' && state.retryCount >= state.maxRetries) {
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
