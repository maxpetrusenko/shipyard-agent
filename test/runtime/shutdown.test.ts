import { describe, expect, it, vi } from 'vitest';
import { drainLoopOnShutdown } from '../../src/runtime/shutdown.js';

describe('drainLoopOnShutdown', () => {
  it('lets the active run drain before issuing shutdown cancellation', async () => {
    const processing = [true, true, false];
    const loop = {
      getStatus: vi.fn(() => ({ processing: processing.shift() ?? false })),
      cancel: vi.fn(() => true),
    };

    const result = await drainLoopOnShutdown(loop, {
      timeoutMs: 20,
      pollMs: 1,
    });

    expect(result).toEqual({ drained: true, cancelled: false });
    expect(loop.cancel).not.toHaveBeenCalled();
  });

  it('cancels with shutdown_signal after the drain window expires', async () => {
    let pollCount = 0;
    const loop = {
      getStatus: vi.fn(() => ({
        processing: pollCount++ < 3,
      })),
      cancel: vi.fn(() => true),
    };

    const result = await drainLoopOnShutdown(loop, {
      timeoutMs: 0,
      cancelWaitMs: 1,
      pollMs: 1,
    });

    expect(result.cancelled).toBe(true);
    expect(loop.cancel).toHaveBeenCalledWith('shutdown_signal');
  });
});
