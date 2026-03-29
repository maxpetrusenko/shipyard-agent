import type { RunResult } from './loop.js';

type ShutdownSource = NonNullable<RunResult['cancellation']>['source'];

export interface ShutdownLoopLike {
  getStatus(): { processing: boolean };
  cancel(source?: ShutdownSource): boolean;
}

interface WaitForLoopDrainOptions {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface DrainLoopOnShutdownOptions extends WaitForLoopDrainOptions {
  cancelWaitMs?: number;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForLoopDrain(
  loop: ShutdownLoopLike,
  opts: WaitForLoopDrainOptions = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 4_500;
  const pollMs = opts.pollMs ?? 50;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  while (loop.getStatus().processing) {
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }

  return true;
}

export async function drainLoopOnShutdown(
  loop: ShutdownLoopLike,
  opts: DrainLoopOnShutdownOptions = {},
): Promise<{ drained: boolean; cancelled: boolean }> {
  const drained = await waitForLoopDrain(loop, opts);
  if (drained) {
    return { drained: true, cancelled: false };
  }

  const cancelled = loop.cancel('shutdown_signal');
  const drainedAfterCancel = await waitForLoopDrain(loop, {
    timeoutMs: opts.cancelWaitMs ?? 750,
    pollMs: opts.pollMs,
    sleep: opts.sleep,
  });

  return { drained: drainedAfterCancel, cancelled };
}
