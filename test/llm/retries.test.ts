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

  it('omits temperature for GPT-5 chat completion requests', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: undefined,
    });
    const client = {
      chat: {
        completions: {
          create,
        },
      },
    } as any;

    await chatCompletionCreateWithRetry(client, {
      model: 'gpt-5-mini',
      temperature: 0.3,
      messages: [{ role: 'user', content: 'hi' }],
    } as any);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
  });
});
