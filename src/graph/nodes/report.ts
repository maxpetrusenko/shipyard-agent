/**
 * Report node: deterministic summary from run state.
 */
import type { ShipyardStateType, LLMMessage } from '../state.js';
import { hasSuccessfulPrToolCall } from '../../tools/commit-and-open-pr.js';

export async function reportNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const completed = state.steps.filter((s) => s.status === 'done').length;
  const uniqueEdited = [...new Set(state.fileEdits.map((e) => e.file_path))];
  const verification = state.verificationResult;
  let prLine = '';
  if (hasSuccessfulPrToolCall(state.toolCallHistory)) {
    prLine = 'PR: created during execute step';
  }

  const text = [
    '## Summary',
    '',
    `Instruction: ${state.instruction}`,
    `Steps completed: ${completed}/${state.steps.length}`,
    `Files edited: ${uniqueEdited.length}`,
    verification
      ? `Verification: ${verification.passed ? 'PASSED' : 'FAILED'}`
      : 'Verification: Not run',
    verification?.error_count
      ? `Errors: ${verification.error_count}`
      : '',
    prLine,
    `Token usage: ${state.tokenUsage?.input ?? 0} input / ${state.tokenUsage?.output ?? 0} output`,
    state.estimatedCost != null
      ? `Estimated cost: $${state.estimatedCost.toFixed(4)}`
      : '',
    `Duration: ${Date.now() - state.runStartedAt}ms`,
  ]
    .filter(Boolean)
    .join('\n');

  const newMessages: LLMMessage[] = [
    ...state.messages,
    { role: 'assistant', content: text },
  ];

  return {
    phase: 'done',
    messages: newMessages,
    tokenUsage: state.tokenUsage,
  };
}
