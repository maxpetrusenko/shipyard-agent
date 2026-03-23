import { describe, it, expect } from 'vitest';
import { detectConflicts, mergeEdits } from '../src/multi-agent/merge.js';
import { shouldCoordinate } from '../src/graph/nodes/coordinate.js';
import type { WorkerResult } from '../src/multi-agent/worker.js';
import type { ShipyardStateType } from '../src/graph/state.js';

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

describe('detectConflicts', () => {
  it('detects overlapping file edits between workers', () => {
    const results: WorkerResult[] = [
      {
        subtaskId: 'w1',
        phase: 'done',
        fileEdits: [
          { file_path: '/src/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
          { file_path: '/src/shared.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 2 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 100,
      },
      {
        subtaskId: 'w2',
        phase: 'done',
        fileEdits: [
          { file_path: '/src/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 3 },
          { file_path: '/src/shared.ts', tier: 2, old_string: 'c', new_string: 'd', timestamp: 4 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 200,
      },
    ];

    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.filePath).toBe('/src/shared.ts');
    expect(conflicts[0]!.workerIds).toEqual(['w1', 'w2']);
  });

  it('returns empty when no conflicts', () => {
    const results: WorkerResult[] = [
      {
        subtaskId: 'w1',
        phase: 'done',
        fileEdits: [
          { file_path: '/src/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 50,
      },
      {
        subtaskId: 'w2',
        phase: 'done',
        fileEdits: [
          { file_path: '/src/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 2 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 60,
      },
    ];

    expect(detectConflicts(results)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeEdits
// ---------------------------------------------------------------------------

describe('mergeEdits', () => {
  it('merges non-conflicting edits and flags conflicts', () => {
    const results: WorkerResult[] = [
      {
        subtaskId: 'w1',
        phase: 'done',
        fileEdits: [
          { file_path: '/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
          { file_path: '/shared.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 2 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 100,
      },
      {
        subtaskId: 'w2',
        phase: 'done',
        fileEdits: [
          { file_path: '/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 3 },
          { file_path: '/shared.ts', tier: 2, old_string: 'c', new_string: 'd', timestamp: 4 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 200,
      },
    ];

    const conflicts = detectConflicts(results);
    const { merged, needsReplan } = mergeEdits(results, conflicts);

    // Non-conflicting edits merged
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.file_path)).toEqual(['/a.ts', '/b.ts']);

    // Conflicting files flagged
    expect(needsReplan).toHaveLength(1);
    expect(needsReplan[0]!.filePath).toBe('/shared.ts');
  });

  it('merges all edits when no conflicts', () => {
    const results: WorkerResult[] = [
      {
        subtaskId: 'w1',
        phase: 'done',
        fileEdits: [
          { file_path: '/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
        ],
        tokenUsage: null,
        error: null,
        durationMs: 50,
      },
    ];

    const { merged, needsReplan } = mergeEdits(results, []);
    expect(merged).toHaveLength(1);
    expect(needsReplan).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shouldCoordinate
// ---------------------------------------------------------------------------

describe('shouldCoordinate', () => {
  const baseState: ShipyardStateType = {
    runId: 'test',
    traceId: 'trace',
    instruction: 'do stuff',
    phase: 'executing',
    steps: [],
    currentStepIndex: 0,
    fileEdits: [],
    toolCallHistory: [],
    verificationResult: null,
    reviewDecision: null,
    reviewFeedback: null,
    contexts: [],
    messages: [],
    error: null,
    retryCount: 0,
    maxRetries: 3,
    tokenUsage: null,
    traceUrl: null,
    runStartedAt: Date.now(),
    workerResults: [],
    modelHint: 'opus',
  };

  it('returns false for single-step plans', () => {
    const state = {
      ...baseState,
      steps: [{ index: 0, description: 'one step', files: ['/a.ts'], status: 'pending' as const }],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });

  it('returns true for multi-step plans with independent files', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: ['/src/a.ts'], status: 'pending' as const },
        { index: 1, description: 'step 2', files: ['/src/b.ts'], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(true);
  });

  it('returns false when steps share files', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: ['/src/shared.ts'], status: 'pending' as const },
        { index: 1, description: 'step 2', files: ['/src/shared.ts'], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });

  it('returns false when steps have no files listed', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: [], status: 'pending' as const },
        { index: 1, description: 'step 2', files: [], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });
});
