import { describe, expect, it, vi, beforeEach } from 'vitest';
import { messagesCreate } from '../../src/config/messages-create.js';
import { chatCompletionCreateWithRetry } from '../../src/llm/openai-helpers.js';

// Mock abort-sleep to avoid real delays during retry
vi.mock('../../src/runtime/abort-sleep.js', () => ({
  sleep: vi.fn(async () => {}),
  abortError: () => Object.assign(new Error('Run cancelled by user'), { name: 'AbortError' }),
}));

// Mock run-signal
vi.mock('../../src/runtime/run-signal.js', () => ({
  getRunAbortSignal: vi.fn(() => null),
}));

import { sleep } from '../../src/runtime/abort-sleep.js';

describe('LLM retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sleep).mockResolvedValue(undefined);
  });

  it('retries Anthropic 429 with backoff then throws after 3 attempts', async () => {
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

    // Now retries 3 times (was 1 before G1 fix)
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries OpenAI 429 with backoff then throws after 3 attempts', async () => {
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

    // Now retries 3 times (was 1 before G1 fix)
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
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
