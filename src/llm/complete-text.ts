/**
 * Text-only LLM completion routed by model id (Anthropic vs OpenAI).
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getClient, wrapSystemPrompt } from '../config/client.js';
import {
  messagesCreate,
  extractCacheMetrics,
} from '../config/messages-create.js';
import { getOpenAIClient } from '../config/openai-client.js';
import {
  getResolvedModelConfigFromState,
  isOpenAiModelId,
  type ModelRole,
} from '../config/model-policy.js';
import { chatCompletionCreateWithRetry } from './openai-helpers.js';
import type { ShipyardStateType } from '../graph/state.js';
import { emitTextChunk } from '../tools/hooks.js';

function anthropicContentToString(
  content: Anthropic.MessageParam['content'],
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      return '';
    })
    .join('');
}

function anthropicMessagesToOpenAi(
  messages: Anthropic.MessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: anthropicContentToString(m.content),
      });
      continue;
    }
    if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: anthropicContentToString(m.content),
      });
    }
  }
  return out;
}

/**
 * Single-turn or multi-turn text completion for a policy role.
 * `messages` are Anthropic-shaped; OpenAI path converts them.
 */
export async function completeTextForRole(
  state: ShipyardStateType,
  role: ModelRole,
  system: string,
  messages: Anthropic.MessageParam[],
  opts?: { liveNode?: string | null },
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
}> {
  const config = getResolvedModelConfigFromState(role, state);

  if (isOpenAiModelId(config.model)) {
    const client = getOpenAIClient();
    const completion = await chatCompletionCreateWithRetry(client, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [
        { role: 'system', content: system },
        ...anthropicMessagesToOpenAi(messages),
      ],
    }, {
      traceName: opts?.liveNode ?? role,
      traceMetadata: {
        node: opts?.liveNode ?? null,
        role,
        provider: 'openai',
        model: config.model,
      },
      traceTags: ['shipyard', 'openai', role],
    });
    const usage = completion.usage;
    const choice = completion.choices[0];
    const text =
      choice?.message?.content && typeof choice.message.content === 'string'
        ? choice.message.content
        : choice?.message?.content &&
            Array.isArray(choice.message.content)
          ? (choice.message.content as OpenAI.Chat.ChatCompletionContentPartText[])
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join('')
          : '';
    if (opts?.liveNode && text.trim()) emitTextChunk(opts.liveNode, text);
    return {
      text,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
  }

  const anthropic = getClient();
  const response = await messagesCreate(anthropic, {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: wrapSystemPrompt(system),
    messages,
  }, {
    liveNode: opts?.liveNode,
    traceName: opts?.liveNode ?? role,
    traceMetadata: {
      node: opts?.liveNode ?? null,
      role,
      provider: 'anthropic',
      model: config.model,
    },
    traceTags: ['shipyard', 'anthropic', role],
  });

  const cm = extractCacheMetrics(response);
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (opts?.liveNode && text.trim()) emitTextChunk(opts.liveNode, text);

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheRead: cm.cacheRead,
    cacheCreation: cm.cacheCreation,
  };
}
