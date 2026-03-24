import { describe, expect, it, vi } from 'vitest';
import { messagesCreate } from '../../src/config/messages-create.js';
import { chatCompletionCreateWithRetry } from '../../src/llm/openai-helpers.js';

describe('LLM retry behavior', () => {
  it('fails fast on Anthropic 429 without retrying', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const create = vi.fn().mockRejectedValue(err);
    const client = {
      messages: {
        create,
      },
    } as any;

    await expect(
      messagesCreate(client, {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 32,
        temperature: 0,
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      } as any),
    ).rejects.toBe(err);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails fast on OpenAI 429 without retrying', async () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const create = vi.fn().mockRejectedValue(err);
    const client = {
      chat: {
        completions: {
          create,
        },
      },
    } as any;

    await expect(
      chatCompletionCreateWithRetry(client, {
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: 'hi' }],
      } as any),
    ).rejects.toBe(err);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
