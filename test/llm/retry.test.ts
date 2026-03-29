import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTransientRetry } from '../../src/llm/retry.js';

// Mock run-signal to control abort
vi.mock('../../src/runtime/run-signal.js', () => ({
  getRunAbortSignal: vi.fn(() => null),
}));

// Mock abort-sleep to avoid real delays
vi.mock('../../src/runtime/abort-sleep.js', () => ({
  sleep: vi.fn(async () => {}),
  abortError: () => Object.assign(new Error('Run cancelled by user'), { name: 'AbortError' }),
}));

import { getRunAbortSignal } from '../../src/runtime/run-signal.js';
import { sleep } from '../../src/runtime/abort-sleep.js';

describe('withTransientRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sleep).mockResolvedValue(undefined);
    vi.mocked(getRunAbortSignal).mockReturnValue(null);
  });

  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withTransientRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on 503 then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValue('recovered');

    const result = await withTransientRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate limit then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValue('done');

    const result = await withTransientRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts on transient error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 overloaded'));

    await expect(withTransientRetry(fn, { maxAttempts: 3 }))
      .rejects.toThrow('503 overloaded');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Invalid API key'));

    await expect(withTransientRetry(fn, { maxAttempts: 3 }))
      .rejects.toThrow('Invalid API key');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(getRunAbortSignal).mockReturnValue(controller.signal);

    const fn = vi.fn().mockRejectedValue(new Error('503 timeout'));

    await expect(withTransientRetry(fn, { maxAttempts: 3 }))
      .rejects.toThrow('503 timeout');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries ECONNRESET', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');

    const result = await withTransientRetry(fn, { maxAttempts: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries timeout errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Request timeout'))
      .mockResolvedValue('ok');

    const result = await withTransientRetry(fn, { maxAttempts: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
