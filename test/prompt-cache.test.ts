/**
 * Tests for prompt caching utilities:
 * - wrapSystemPrompt (static + dynamic context breakpoints)
 * - withCachedTools (tool schema caching)
 * - extractCacheMetrics (response metric extraction)
 * - estimateCost (cache-aware pricing)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  wrapSystemPrompt,
  withCachedTools,
  CACHE_CONTROL,
} from '../src/config/client.js';
import { extractCacheMetrics } from '../src/config/messages-create.js';
import { estimateCost } from '../src/config/model-policy.js';
import { stripToolResultCacheControls } from '../src/llm/anthropic-tool-dispatch.js';

// ---------------------------------------------------------------------------
// wrapSystemPrompt
// ---------------------------------------------------------------------------

describe('wrapSystemPrompt', () => {
  it('returns TextBlockParam[] with cache_control on last block', () => {
    const blocks = wrapSystemPrompt('You are a coding agent.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    expect(blocks[0]!.text).toBe('You are a coding agent.');
    expect(blocks[0]!.cache_control).toEqual(CACHE_CONTROL);
  });

  it('creates two breakpoints when dynamic context is provided', () => {
    const blocks = wrapSystemPrompt(
      'Static system prompt.',
      '# Context\n\nRepo map here...',
    );
    expect(blocks).toHaveLength(2);

    expect(blocks[0]!.text).toBe('Static system prompt.');
    expect(blocks[0]!.cache_control).toEqual(CACHE_CONTROL);

    expect(blocks[1]!.text).toBe('# Context\n\nRepo map here...');
    expect(blocks[1]!.cache_control).toEqual(CACHE_CONTROL);
  });

  it('single block when context is undefined', () => {
    const blocks = wrapSystemPrompt('Prompt only.', undefined);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('Prompt only.');
    expect(blocks[0]!.cache_control).toEqual(CACHE_CONTROL);
  });

  it('single block when context is empty string (falsy)', () => {
    const blocks = wrapSystemPrompt('Prompt only.', '');
    expect(blocks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// withCachedTools
// ---------------------------------------------------------------------------

describe('withCachedTools', () => {
  const sampleTools = [
    {
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
      },
    },
    {
      name: 'write_file',
      description: 'Write a file',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
      },
    },
  ];

  it('adds cache_control to the last tool only', () => {
    const cached = withCachedTools(sampleTools);
    expect(cached).toHaveLength(2);
    expect(cached[0]!.cache_control).toBeUndefined();
    expect(cached[1]!.cache_control).toEqual(CACHE_CONTROL);
  });

  it('does not mutate the original array', () => {
    const cached = withCachedTools(sampleTools);
    expect(sampleTools[1]!.cache_control).toBeUndefined();
    expect(cached[1]!.cache_control).toEqual(CACHE_CONTROL);
  });

  it('returns empty array unchanged', () => {
    const cached = withCachedTools([]);
    expect(cached).toEqual([]);
  });

  it('handles single-tool array', () => {
    const cached = withCachedTools([sampleTools[0]!]);
    expect(cached).toHaveLength(1);
    expect(cached[0]!.cache_control).toEqual(CACHE_CONTROL);
  });
});

// ---------------------------------------------------------------------------
// stripToolResultCacheControls
// ---------------------------------------------------------------------------

describe('stripToolResultCacheControls', () => {
  it('removes cache_control only from prior tool_result blocks', () => {
    const messages = [
      { role: 'user' as const, content: 'initial request' },
      {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_1',
            content: '{"ok":true}',
            cache_control: CACHE_CONTROL,
          },
          {
            type: 'text' as const,
            text: 'keep me cached',
            cache_control: CACHE_CONTROL,
          },
        ],
      },
    ];

    const stripped = stripToolResultCacheControls(messages);
    const toolResult = stripped[1]!.content[0]!;
    const textBlock = stripped[1]!.content[1]!;

    expect('cache_control' in toolResult).toBe(false);
    expect(textBlock).toMatchObject({
      type: 'text',
      cache_control: CACHE_CONTROL,
    });
    expect(messages[1]!.content[0]!).toMatchObject({
      type: 'tool_result',
      cache_control: CACHE_CONTROL,
    });
  });
});

// ---------------------------------------------------------------------------
// extractCacheMetrics
// ---------------------------------------------------------------------------

describe('extractCacheMetrics', () => {
  it('extracts cache_read and cache_creation tokens', () => {
    const fakeResponse = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
    } as never;

    const metrics = extractCacheMetrics(fakeResponse);
    expect(metrics.cacheRead).toBe(800);
    expect(metrics.cacheCreation).toBe(200);
  });

  it('defaults to 0 when cache fields are absent', () => {
    const fakeResponse = {
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
      },
    } as never;

    const metrics = extractCacheMetrics(fakeResponse);
    expect(metrics.cacheRead).toBe(0);
    expect(metrics.cacheCreation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// estimateCost with cache-aware pricing
// ---------------------------------------------------------------------------

describe('estimateCost cache pricing', () => {
  const opusModel = 'claude-opus-4-6';
  const opusInputRate = 15 / 1_000_000;

  it('without cache args matches original behavior', () => {
    const cost = estimateCost(opusModel, 1_000_000, 0);
    expect(cost).toBeCloseTo(15, 5);
  });

  it('cache reads are charged at 10% of input rate', () => {
    // 1M tokens all from cache read, 0 uncached, 0 output
    const cost = estimateCost(opusModel, 0, 0, 1_000_000, 0);
    expect(cost).toBeCloseTo(1_000_000 * opusInputRate * 0.1, 5);
    expect(cost).toBeCloseTo(1.5, 5);
  });

  it('cache writes are charged at 125% of input rate', () => {
    // 1M tokens all cache creation (part of inputTokens)
    const cost = estimateCost(opusModel, 1_000_000, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(1_000_000 * opusInputRate * 1.25, 5);
    expect(cost).toBeCloseTo(18.75, 5);
  });

  it('mixed cache scenario calculates correctly', () => {
    // 100K uncached + 50K cache write + 200K cache read, 10K output
    const inputTokens = 150_000; // includes 50K cache creation + 100K uncached
    const outputTokens = 10_000;
    const cacheRead = 200_000;
    const cacheCreation = 50_000;

    const cost = estimateCost(
      opusModel,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheCreation,
    );

    const outputRate = 75 / 1_000_000;
    const expected =
      100_000 * opusInputRate + // uncached
      50_000 * opusInputRate * 1.25 + // cache write
      200_000 * opusInputRate * 0.1 + // cache read
      10_000 * outputRate; // output

    expect(cost).toBeCloseTo(expected, 5);
  });

  it('returns null for unknown models regardless of cache args', () => {
    expect(estimateCost('unknown-model', 1_000_000, 1_000_000, 500_000, 200_000)).toBeNull();
  });
});
