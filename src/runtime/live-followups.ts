/**
 * In-run follow-up message queue.
 *
 * Lets active runs consume user follow-ups before their next model call
 * without waiting for a full follow-up run enqueue.
 */

const pendingByRun = new Map<string, string[]>();

export function enqueueLiveFollowup(runId: string, message: string): void {
  const text = message.trim();
  if (!runId || !text) return;
  const list = pendingByRun.get(runId) ?? [];
  list.push(text);
  pendingByRun.set(runId, list);
}

export function consumeLiveFollowups(runId: string): string[] {
  const list = pendingByRun.get(runId) ?? [];
  pendingByRun.delete(runId);
  return list;
}

export function hasLiveFollowups(runId: string): boolean {
  return (pendingByRun.get(runId)?.length ?? 0) > 0;
}

export function clearLiveFollowups(runId: string): void {
  pendingByRun.delete(runId);
}
