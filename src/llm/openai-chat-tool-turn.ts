/**
 * Append one assistant + tool-result round to an OpenAI chat conversation.
 * Shared by plan-openai and execute-openai tool loops.
 */
import type OpenAI from 'openai';
import { TOOL_RESULT_MAX_CHARS } from '../constants/limits.js';
import { parseToolArguments } from './openai-helpers.js';

export type OpenAiToolDispatchFn = (
  name: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export async function appendOpenAiToolTurn(
  conversation: OpenAI.Chat.ChatCompletionMessageParam[],
  assistantMessage: OpenAI.Chat.ChatCompletionMessage,
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[],
  dispatchOne: OpenAiToolDispatchFn,
  options?: { unsupportedToolMessage?: string },
): Promise<void> {
  const unsupported =
    options?.unsupportedToolMessage ?? 'Unsupported tool type';

  conversation.push({
    role: 'assistant',
    content: assistantMessage.content ?? null,
    tool_calls: toolCalls,
  });

  for (const tc of toolCalls) {
    if (tc.type !== 'function') {
      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({
          success: false,
          message: unsupported,
        }).slice(0, TOOL_RESULT_MAX_CHARS),
      });
      continue;
    }
    const inputObj = parseToolArguments(tc.function.arguments);
    const result = await dispatchOne(tc.function.name, inputObj);
    conversation.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS),
    });
  }
}
