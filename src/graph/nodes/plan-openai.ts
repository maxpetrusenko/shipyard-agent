/**
 * Plan node tool loop via OpenAI Chat Completions (subset of tools).
 */
import OpenAI from 'openai';
import { getOpenAIClient } from '../../config/openai-client.js';
import type { ModelConfig } from '../../config/model-policy.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import { createPlanLiveHooks, emitTextChunk } from '../../tools/hooks.js';
import { anthropicToolSchemasToOpenAi } from '../../llm/openai-tool-schemas.js';
import {
  assistantTextContent,
  addChatCompletionUsage,
  chatCompletionCreateWithRetry,
} from '../../llm/openai-helpers.js';
import { appendOpenAiToolTurn } from '../../llm/openai-chat-tool-turn.js';
import type { ShipyardStateType, PlanStep, LLMMessage } from '../state.js';

const PLAN_TOOL_NAMES = new Set([
  'read_file',
  'grep',
  'glob',
  'ls',
  'bash',
]);

const planOpenAiTools = anthropicToolSchemasToOpenAi(
  TOOL_SCHEMAS.filter((t) => PLAN_TOOL_NAMES.has(t.name)),
);

export async function runOpenAiPlanLoop(params: {
  state: ShipyardStateType;
  config: ModelConfig;
  system: string;
  initialUserText: string;
}): Promise<{
  steps: PlanStep[];
  newMessages: LLMMessage[];
  inputTokens: number;
  outputTokens: number;
}> {
  const { state, config, system, initialUserText } = params;
  const client = getOpenAIClient();

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: initialUserText },
  ];

  const usageAcc = {
    input: state.tokenUsage?.input ?? 0,
    output: state.tokenUsage?.output ?? 0,
  };
  const newMessages: LLMMessage[] = [...state.messages];
  let steps: PlanStep[] = [];
  const maxToolRounds = 15;

  for (let round = 0; round < maxToolRounds; round++) {
    const completion = await chatCompletionCreateWithRetry(client, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [{ role: 'system', content: system }, ...conversation],
      tools: planOpenAiTools,
      tool_choice: 'auto',
    });

    addChatCompletionUsage(usageAcc, completion.usage);

    const choice = completion.choices[0];
    if (!choice) break;

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    const textContent = assistantTextContent(msg);
    if (textContent.trim()) emitTextChunk('plan', textContent);
    const planMatch = textContent.match(/<plan>([\s\S]*?)<\/plan>/);
    if (planMatch) {
      try {
        const parsed = JSON.parse(planMatch[1]!) as Array<{
          index: number;
          description: string;
          files: string[];
        }>;
        steps = parsed.map((s) => ({
          ...s,
          status: 'pending' as const,
        }));
      } catch {
        /* continue */
      }
    }

    if (steps.length > 0 || choice.finish_reason === 'stop') {
      newMessages.push({ role: 'assistant', content: textContent });
      break;
    }

    if (toolCalls && toolCalls.length > 0) {
      await appendOpenAiToolTurn(
        conversation,
        msg,
        toolCalls,
        (name, input) => dispatchTool(name, input, createPlanLiveHooks()),
        { unsupportedToolMessage: 'Unsupported tool type' },
      );
      continue;
    }

    newMessages.push({ role: 'assistant', content: textContent });
    break;
  }

  if (steps.length === 0) {
    steps = [
      {
        index: 0,
        description: state.instruction,
        files: [],
        status: 'pending',
      },
    ];
  }

  return {
    steps,
    newMessages,
    inputTokens: usageAcc.input,
    outputTokens: usageAcc.output,
  };
}
