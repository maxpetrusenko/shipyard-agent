/**
 * Report node: summarize run results for the user.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../../config/model-policy.js';
import type { ShipyardStateType, LLMMessage } from '../state.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const REPORT_SYSTEM = `Summarize the completed coding run. Include:
1. What was done (files changed, edits made)
2. Verification status (typecheck + tests)
3. Any issues or caveats

Be concise. Use bullet points.`;

export async function reportNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getModelConfig('summary');
  const anthropic = getClient();

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
    `Duration: ${Date.now() - state.runStartedAt}ms`,
  ]
    .filter(Boolean)
    .join('\n');

  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: summary }],
  });

  inputTokens += response.usage.input_tokens;
  outputTokens += response.usage.output_tokens;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const newMessages: LLMMessage[] = [
    ...state.messages,
    { role: 'assistant', content: text },
  ];

  return {
    phase: 'done',
    messages: newMessages,
    tokenUsage: { input: inputTokens, output: outputTokens },
  };
}
