import { describe, expect, it } from 'vitest';
import {
  clearLiveFollowups,
  consumeLiveFollowups,
  enqueueLiveFollowup,
  hasLiveFollowups,
} from '../../src/runtime/live-followups.js';

describe('live follow-ups queue', () => {
  it('enqueues and consumes messages per run', () => {
    const runId = 'run-live-1';
    clearLiveFollowups(runId);
    enqueueLiveFollowup(runId, 'first');
    enqueueLiveFollowup(runId, 'second');

    expect(hasLiveFollowups(runId)).toBe(true);
    expect(consumeLiveFollowups(runId)).toEqual(['first', 'second']);
    expect(hasLiveFollowups(runId)).toBe(false);
    expect(consumeLiveFollowups(runId)).toEqual([]);
  });
});
