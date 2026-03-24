import { describe, expect, it } from 'vitest';
import { openAiChatUsesMaxCompletionTokens } from '../src/llm/openai-helpers.js';

describe('openAiChatUsesMaxCompletionTokens', () => {
  it('is true for GPT-5 and Codex ids used in the dashboard', () => {
    expect(openAiChatUsesMaxCompletionTokens('gpt-5-mini')).toBe(true);
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
