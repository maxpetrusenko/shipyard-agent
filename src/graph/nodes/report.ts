/**
 * Report node: deterministic summary from run state.
 */
import type { ShipyardStateType, LLMMessage } from '../state.js';
import { hasSuccessfulPrToolCall } from '../../tools/commit-and-open-pr.js';
import { traceDecision } from '../../runtime/trace-helpers.js';

export async function reportNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  return traceDecision('report_summary', {
    phase: state.phase,
    stepsCompleted: state.steps.filter((s) => s.status === 'done').length,
    totalSteps: state.steps.length,
    filesEdited: [...new Set(state.fileEdits.map((e) => e.file_path))].length,
    hasPR: hasSuccessfulPrToolCall(state.toolCallHistory),
    error: state.error?.slice(0, 300),
  }, async () => {
    const failed = state.phase === 'error' || Boolean(state.error);
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
      `Outcome: ${failed ? 'FAILED' : 'COMPLETED'}`,
      `Instruction: ${state.instruction}`,
      `Steps completed: ${completed}/${state.steps.length}`,
      `Files edited: ${uniqueEdited.length}`,
      verification
        ? `Verification: ${verification.passed && !failed ? 'PASSED' : 'FAILED'}`
        : 'Verification: Not run',
      verification?.error_count
        ? `Errors: ${verification.error_count}`
        : '',
      state.error ? `Error: ${state.error}` : '',
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
      phase: failed ? 'error' as const : 'done' as const,
      error: state.error,
      messages: newMessages,
      tokenUsage: state.tokenUsage,
    };
  });
}
