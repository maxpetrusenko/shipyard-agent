/**
 * Shared OpenAI Chat Completions helpers (retry, parsing).
 */
import OpenAI from 'openai';
import { abortError } from '../runtime/abort-sleep.js';
import { getRunAbortSignal } from '../runtime/run-signal.js';

export { abortError };

/**
 * Newer OpenAI Chat Completions models reject `max_tokens` and require
 * `max_completion_tokens` instead (e.g. GPT-5 family, o-series).
 */
export function openAiChatUsesMaxCompletionTokens(model: string): boolean {
  const m = model.trim().toLowerCase();
  return (
    m.startsWith('gpt-5') ||
    m.startsWith('o1') ||
    m.startsWith('o2') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  );
}

function normalizeOpenAiChatCompletionBody(
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const model = typeof body.model === 'string' ? body.model : '';
  if (!openAiChatUsesMaxCompletionTokens(model)) {
    return body;
  }
  const b = body as unknown as Record<string, unknown>;
  const maxTok = b['max_tokens'];
  const maxComp = b['max_completion_tokens'];
  if (typeof maxComp === 'number') {
    const next = { ...b };
    delete next['max_tokens'];
    return next as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  }
  if (typeof maxTok === 'number') {
    const next = { ...b };
    delete next['max_tokens'];
    next['max_completion_tokens'] = maxTok;
    return next as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  }
  return body;
}

export async function chatCompletionCreateWithRetry(
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.ChatCompletion> {
  const normalized = normalizeOpenAiChatCompletionBody(body);
  const signal = getRunAbortSignal();
  try {
    return await client.chat.completions.create(normalized, {
      signal: signal ?? undefined,
    });
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  }
}

/** Accumulate prompt/completion tokens from a chat completion response. */
export function addChatCompletionUsage(
  acc: { input: number; output: number },
  usage: OpenAI.CompletionUsage | undefined,
): void {
  if (!usage) return;
  acc.input += usage.prompt_tokens ?? 0;
  acc.output += usage.completion_tokens ?? 0;
}

export function parseToolArguments(
  raw: string | undefined,
): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function assistantTextContent(
  msg: OpenAI.Chat.ChatCompletionMessage,
): string {
  const c = msg.content;
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts = c as OpenAI.Chat.ChatCompletionContentPart[];
  return parts
    .filter(
      (p): p is OpenAI.Chat.ChatCompletionContentPartText => p.type === 'text',
    )
    .map((p) => p.text)
    .join('');
}
