/**
 * Wraps `messages.create`.
 * Honors run abort (Stop): passes signal into the SDK.
 * Also provides cache metric extraction for cost tracking and optional live-feed text emission.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { getRunAbortSignal } from '../runtime/run-signal.js';
import { emitTextChunk } from '../tools/hooks.js';
import { OPS } from '../server/ops.js';
import { withTransientRetry } from '../llm/retry.js';

// ---------------------------------------------------------------------------
// Cache metrics
// ---------------------------------------------------------------------------

export interface CacheMetrics {
  cacheRead: number;
  cacheCreation: number;
}

/** Extract prompt-cache token counts from an Anthropic response. */
export function extractCacheMetrics(
  response: Anthropic.Message,
): CacheMetrics {
  const usage = response.usage as unknown as Record<string, number>;
  return {
    cacheRead: usage['cache_read_input_tokens'] ?? 0,
    cacheCreation: usage['cache_creation_input_tokens'] ?? 0,
  };
}

export async function messagesCreate(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  opts?: {
    liveNode?: string | null;
    traceName?: string;
    traceMetadata?: Record<string, unknown>;
    traceTags?: string[];
  },
): Promise<Anthropic.Message> {
  const signal = getRunAbortSignal();
  const response = await withTransientRetry(
    () =>
      client.messages.create(
        params,
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
        } as Anthropic.RequestOptions,
      ),
    { label: 'Anthropic messagesCreate' },
  );

  // Log cache utilization when prompt caching is active
  const cm = extractCacheMetrics(response);
  if (cm.cacheRead > 0 || cm.cacheCreation > 0) {
    OPS.increment('shipyard.llm.cache_read_tokens', cm.cacheRead);
    OPS.increment('shipyard.llm.cache_write_tokens', cm.cacheCreation);
    const total = response.usage.input_tokens + cm.cacheRead;
    const pct = total > 0 ? Math.round((cm.cacheRead / total) * 100) : 0;
    console.log(
      `[ship-agent] Cache: ${cm.cacheRead} read (${pct}%) / ${cm.cacheCreation} written | ${response.usage.input_tokens} uncached input`,
    );
  }

  if (opts?.liveNode) {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text) emitTextChunk(opts.liveNode, text);
  }

  return response;
}
