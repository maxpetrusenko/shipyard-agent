import { describe, expect, it } from 'vitest';
import {
  addChatCompletionUsage,
  extractOpenAiCacheMetrics,
  openAiChatUsesMaxCompletionTokens,
} from '../src/llm/openai-helpers.js';

describe('openAiChatUsesMaxCompletionTokens', () => {
  it('is true for GPT-5 and Codex ids used in the dashboard', () => {
    expect(openAiChatUsesMaxCompletionTokens('gpt-5.4-mini')).toBe(true);
    expect(openAiChatUsesMaxCompletionTokens('gpt-5.1-codex')).toBe(true);
    expect(openAiChatUsesMaxCompletionTokens('gpt-5.3-codex')).toBe(true);
  });

  it('is true for o-series chat models', () => {
    expect(openAiChatUsesMaxCompletionTokens('o1-preview')).toBe(true);
    expect(openAiChatUsesMaxCompletionTokens('o3-mini')).toBe(true);
  });

  it('is false for GPT-4 era ids', () => {
    expect(openAiChatUsesMaxCompletionTokens('gpt-4o')).toBe(false);
    expect(openAiChatUsesMaxCompletionTokens('gpt-4o-mini')).toBe(false);
  });
});

describe('OpenAI cache usage helpers', () => {
  it('extracts cached prompt tokens from chat completion usage', () => {
    expect(
      extractOpenAiCacheMetrics({
        completion_tokens: 12,
        prompt_tokens: 34,
        total_tokens: 46,
        prompt_tokens_details: {
          cached_tokens: 21,
        },
      } as any),
    ).toEqual({
      cacheRead: 21,
      cacheCreation: 0,
    });
  });

  it('adds cache read tokens and leaves cache creation explicit at zero', () => {
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
    addChatCompletionUsage(usage, {
      completion_tokens: 9,
      prompt_tokens: 18,
      total_tokens: 27,
      prompt_tokens_details: {
        cached_tokens: 7,
      },
    } as any);

    expect(usage).toEqual({
      input: 18,
      output: 9,
      cacheRead: 7,
      cacheCreation: 0,
    });
  });
});
