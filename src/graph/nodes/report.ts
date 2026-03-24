/**
 * Report node: summarize run results for the user.
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
import type { ShipyardStateType, LLMMessage } from '../state.js';

const REPORT_SYSTEM = `Summarize the completed coding run. Include:
1. What was done (files changed, edits made)
2. Verification status (typecheck + tests)
3. Any issues or caveats

Be concise. Use bullet points.`;

export async function reportNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('summary', state);

  const summary = [
    `Instruction: ${state.instruction}`,
    '',
    `Steps completed: ${state.steps.filter((s) => s.status === 'done').length}/${state.steps.length}`,
    '',
    'File edits:',
    ...state.fileEdits.map(
      (e) => `- ${e.file_path} (tier ${e.tier})`,
    ),
    '',
    `Verification: ${state.verificationResult?.passed ? 'PASSED' : 'FAILED'}`,
    state.verificationResult?.error_count
      ? `Errors: ${state.verificationResult.error_count}`
      : '',
    '',
    `Token usage: ${state.tokenUsage?.input ?? 0} input / ${state.tokenUsage?.output ?? 0} output`,
    state.estimatedCost != null ? `Estimated cost: $${state.estimatedCost.toFixed(4)}` : '',
    `Duration: ${Date.now() - state.runStartedAt}ms`,
  ]
    .filter(Boolean)
    .join('\n');

  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;
  let cacheReadTokens = state.tokenUsage?.cacheRead ?? 0;
  let cacheCreationTokens = state.tokenUsage?.cacheCreation ?? 0;

  let text: string;
  if (isOpenAiModelId(config.model)) {
    const r = await completeTextForRole(state, 'summary', REPORT_SYSTEM, [
      { role: 'user', content: summary },
    ], { liveNode: 'report' });
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
      system: wrapSystemPrompt(REPORT_SYSTEM),
      messages: [{ role: 'user', content: summary }],
    }, { liveNode: 'report' });

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

  const newMessages: LLMMessage[] = [
    ...state.messages,
    { role: 'assistant', content: text },
  ];

  return {
    phase: 'done',
    messages: newMessages,
    tokenUsage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheCreation: cacheCreationTokens,
    },
  };
}
