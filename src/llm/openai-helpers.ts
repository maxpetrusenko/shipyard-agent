/**
 * Shared OpenAI Chat Completions helpers (retry, parsing).
 */
import OpenAI from 'openai';
import { abortError } from '../runtime/abort-sleep.js';
import { getRunAbortSignal } from '../runtime/run-signal.js';
import { withTransientRetry } from './retry.js';

export { abortError };

export interface OpenAiCacheMetrics {
  cacheRead: number;
  cacheCreation: number;
}

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

function openAiChatOmitsTemperature(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-5');
}

function normalizeOpenAiChatCompletionBody(
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  const model = typeof body.model === 'string' ? body.model : '';
  const next = {
    ...(body as unknown as Record<string, unknown>),
  } as Record<string, unknown>;

  if (openAiChatUsesMaxCompletionTokens(model)) {
    const maxTok = next['max_tokens'];
    const maxComp = next['max_completion_tokens'];
    if (typeof maxComp === 'number') {
      delete next['max_tokens'];
    } else if (typeof maxTok === 'number') {
      delete next['max_tokens'];
      next['max_completion_tokens'] = maxTok;
    }
  }

  if (openAiChatOmitsTemperature(model)) {
    delete next['temperature'];
  }

  return next as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
}

export async function chatCompletionCreateWithRetry(
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  opts?: {
    traceName?: string;
    traceMetadata?: Record<string, unknown>;
    traceTags?: string[];
  },
): Promise<OpenAI.Chat.ChatCompletion> {
  const normalized = normalizeOpenAiChatCompletionBody(body);
  const signal = getRunAbortSignal();
  return withTransientRetry(
    async () => {
      try {
        return await client.chat.completions.create(
          normalized,
          {
            signal: signal ?? undefined,
            langsmithExtra:
              opts?.traceName || opts?.traceMetadata || opts?.traceTags
                ? {
                    ...(opts?.traceName ? { name: opts.traceName } : {}),
                    ...(opts?.traceMetadata ? { metadata: opts.traceMetadata } : {}),
                    ...(opts?.traceTags ? { tags: opts.traceTags } : {}),
                  }
                : undefined,
          } as OpenAI.RequestOptions,
        );
      } catch (e) {
        if (signal?.aborted) throw abortError();
        throw e;
      }
    },
    { label: 'OpenAI chatCompletionCreate' },
  );
}

/**
 * Chat Completions surfaces cached prompt reads, but not separate cache writes.
 */
export function extractOpenAiCacheMetrics(
  usage: OpenAI.CompletionUsage | undefined,
): OpenAiCacheMetrics {
  return {
    cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreation: 0,
  };
}

/** Accumulate prompt/completion tokens from a chat completion response. */
export function addChatCompletionUsage(
  acc: { input: number; output: number; cacheRead: number; cacheCreation: number },
  usage: OpenAI.CompletionUsage | undefined,
): void {
  if (!usage) return;
  acc.input += usage.prompt_tokens ?? 0;
  acc.output += usage.completion_tokens ?? 0;
  const cache = extractOpenAiCacheMetrics(usage);
  acc.cacheRead += cache.cacheRead;
  acc.cacheCreation += cache.cacheCreation;
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
