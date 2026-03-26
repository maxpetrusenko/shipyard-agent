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
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
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

function isStandaloneVerificationStep(step: PlanStep): boolean {
  const desc = step.description.toLowerCase();
  const mentionsVerify =
    desc.includes('type-check') ||
    desc.includes('typecheck') ||
    desc.includes('pnpm test') ||
    desc.includes('run tests') ||
    desc.includes('verification');
  const looksLikeEdit =
    desc.includes('add ') ||
    desc.includes('update ') ||
    desc.includes('edit ') ||
    desc.includes('refactor ') ||
    desc.includes('rename ') ||
    desc.includes('implement ');
  return mentionsVerify && !looksLikeEdit && step.files.length === 0;
}

function pruneRedundantVerificationSteps(steps: PlanStep[]): PlanStep[] {
  const hasImplementationStep = steps.some((s) => !isStandaloneVerificationStep(s));
  if (!hasImplementationStep) return steps;
  const filtered = steps.filter((s) => !isStandaloneVerificationStep(s));
  if (filtered.length === 0) return steps;
  return filtered.map((s, i) => ({ ...s, index: i }));
}

export async function runOpenAiPlanLoop(params: {
  state: ShipyardStateType;
  config: ModelConfig;
  system: string;
  initialUserText: string;
  runId: string;
}): Promise<{
  steps: PlanStep[];
  newMessages: LLMMessage[];
  inputTokens: number;
  outputTokens: number;
}> {
  const { state, config, system, initialUserText, runId } = params;
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
    const liveFollowups = consumeLiveFollowups(runId);
    if (liveFollowups.length > 0) {
      conversation.push({
        role: 'user',
        content: liveFollowups.join('\n\n'),
      });
      newMessages.push({
        role: 'assistant',
        content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before planning call.`,
      });
    }

    const completion = await chatCompletionCreateWithRetry(client, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [{ role: 'system', content: system }, ...conversation],
      tools: planOpenAiTools,
      tool_choice: 'auto',
    }, {
      traceName: 'plan',
      traceMetadata: { node: 'plan', provider: 'openai', model: config.model },
      traceTags: ['shipyard', 'plan', 'openai'],
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
  steps = pruneRedundantVerificationSteps(steps);

  return {
    steps,
    newMessages,
    inputTokens: usageAcc.input,
    outputTokens: usageAcc.output,
  };
}
