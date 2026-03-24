/**
 * AbortSignal for the currently executing run (sequential queue: one active run).
 * Wired from InstructionLoop so Stop cancels in-flight HTTP (Anthropic) and shell (verify).
 */

let currentSignal: AbortSignal | null = null;

export function setRunAbortSignal(signal: AbortSignal | null): void {
  currentSignal = signal;
}

export function getRunAbortSignal(): AbortSignal | null {
  return currentSignal;
}
