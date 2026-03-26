/**
 * Report node: deterministic summary from run state.
 */
import type { ShipyardStateType, LLMMessage } from '../state.js';
import {
  commitAndOpenPr,
  hasSuccessfulPrToolCall,
} from '../../tools/commit-and-open-pr.js';

function toPrTitle(instruction: string): string {
  const normalized = instruction
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 56);
  return normalized ? `feat: ${normalized}` : 'feat: shipyard automated change';
}

function toPrBody(state: ShipyardStateType, uniqueEdited: string[]): string {
  return [
    '## Description',
    `Automated Shipyard run for instruction: "${state.instruction.trim()}".`,
    `Implemented ${state.steps.filter((s) => s.status === 'done').length} step(s) touching ${uniqueEdited.length} file(s).`,
    '',
    '## Test Plan',
    '- [ ] Review CI checks on this branch',
  ].join('\n');
}

export async function reportNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const completed = state.steps.filter((s) => s.status === 'done').length;
  const uniqueEdited = [...new Set(state.fileEdits.map((e) => e.file_path))];
  const verification = state.verificationResult;
  let prLine = '';

  const shouldTryAutoPr =
    state.reviewDecision === 'done' &&
    Boolean(verification?.passed) &&
    uniqueEdited.length > 0 &&
    !hasSuccessfulPrToolCall(state.toolCallHistory);

  if (shouldTryAutoPr) {
    const prResult = await commitAndOpenPr({
      title: toPrTitle(state.instruction),
      body: toPrBody(state, uniqueEdited),
      branch_name: `shipyard/${state.runId}`,
      commit_message: `feat: shipyard run ${state.runId}`,
      file_paths: uniqueEdited,
      draft: true,
    });
    if (prResult.success && prResult.pr_url) {
      prLine = `PR: ${prResult.pr_url}`;
    } else if (prResult.error) {
      prLine = `PR: auto-create skipped (${prResult.error})`;
    }
  } else if (hasSuccessfulPrToolCall(state.toolCallHistory)) {
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
