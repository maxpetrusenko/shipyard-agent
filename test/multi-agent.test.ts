import { describe, it, expect } from 'vitest';
import { detectConflicts, mergeEdits } from '../src/multi-agent/merge.js';
import { shouldCoordinate } from '../src/graph/nodes/coordinate.js';
import type { WorkerResult } from '../src/multi-agent/worker.js';
import type { ShipyardStateType } from '../src/graph/state.js';

// ---------------------------------------------------------------------------
// Helper: create a WorkerResult with defaults
// ---------------------------------------------------------------------------

function makeWorkerResult(
  overrides: Partial<WorkerResult> & Pick<WorkerResult, 'subtaskId'>,
): WorkerResult {
  return {
    phase: 'done',
    fileEdits: [],
    toolCallHistory: [],
    tokenUsage: null,
    error: null,
    durationMs: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

describe('detectConflicts', () => {
  it('detects file-level conflicts between workers', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/src/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
          { file_path: '/src/shared.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 2 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          { file_path: '/src/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 3 },
          { file_path: '/src/shared.ts', tier: 2, old_string: 'c', new_string: 'd', timestamp: 4 },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.filePath).toBe('/src/shared.ts');
    expect(conflicts[0]!.workerIds).toEqual(['w1', 'w2']);
  });

  it('returns empty when no conflicts', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/src/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          { file_path: '/src/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 2 },
        ],
      }),
    ];

    expect(detectConflicts(results)).toHaveLength(0);
  });

  it('detects overlapping edits with shared lines', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          {
            file_path: '/src/shared.ts',
            tier: 1,
            old_string: 'function foo() {\n  return 1;\n}',
            new_string: 'function foo() {\n  return 2;\n}',
            timestamp: 1,
          },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          {
            file_path: '/src/shared.ts',
            tier: 1,
            old_string: 'function foo() {\n  return 1;\n}\n\nfunction bar() {}',
            new_string: 'function foo() {\n  return 3;\n}\n\nfunction bar() {}',
            timestamp: 2,
          },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('overlapping');
  });

  it('marks non-overlapping edits to same file as non_overlapping', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          {
            file_path: '/src/shared.ts',
            tier: 1,
            old_string: 'const UNIQUE_VAR_A = 1;',
            new_string: 'const UNIQUE_VAR_A = 2;',
            timestamp: 1,
          },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          {
            file_path: '/src/shared.ts',
            tier: 1,
            old_string: 'const UNIQUE_VAR_B = 3;',
            new_string: 'const UNIQUE_VAR_B = 4;',
            timestamp: 2,
          },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('non_overlapping');
  });
});

// ---------------------------------------------------------------------------
// mergeEdits
// ---------------------------------------------------------------------------

describe('mergeEdits', () => {
  it('keeps non-conflicting edits and first worker edits for overlapping conflicts', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
          { file_path: '/shared.ts', tier: 1, old_string: 'shared line alpha', new_string: 'b', timestamp: 2 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          { file_path: '/b.ts', tier: 1, old_string: 'p', new_string: 'q', timestamp: 3 },
          { file_path: '/shared.ts', tier: 2, old_string: 'shared line alpha', new_string: 'd', timestamp: 4 },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    const { merged, needsReplan } = mergeEdits(results, conflicts);

    // Non-conflicting files + first worker's edit on conflicting file
    expect(merged).toHaveLength(3);
    const paths = merged.map((e) => e.file_path);
    expect(paths).toContain('/a.ts');
    expect(paths).toContain('/b.ts');
    expect(paths).toContain('/shared.ts');

    // The /shared.ts edit should be w1's (new_string: 'b')
    const sharedEdit = merged.find((e) => e.file_path === '/shared.ts');
    expect(sharedEdit!.new_string).toBe('b');

    // Conflict still reported for awareness
    expect(needsReplan).toHaveLength(1);
    expect(needsReplan[0]!.filePath).toBe('/shared.ts');
  });

  it('merges all edits for non-overlapping same-file conflicts', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/shared.ts', tier: 1, old_string: 'const UNIQUE_A = 1;', new_string: 'const UNIQUE_A = 2;', timestamp: 1 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          { file_path: '/shared.ts', tier: 1, old_string: 'const UNIQUE_B = 3;', new_string: 'const UNIQUE_B = 4;', timestamp: 2 },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    // Non-overlapping edits to same file should all merge
    expect(conflicts[0]!.type).toBe('non_overlapping');

    const { merged, needsReplan } = mergeEdits(results, conflicts);
    // Both edits should be kept (non-overlapping)
    expect(merged).toHaveLength(2);
    expect(needsReplan).toHaveLength(0);
  });

  it('merges all edits when no conflicts', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 },
        ],
      }),
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
    fileOverlaySnapshots: null,
    estimatedCost: null,
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

  it('returns true when some steps are independent and some share', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: ['/src/a.ts'], status: 'pending' as const },
        { index: 1, description: 'step 2', files: ['/src/b.ts'], status: 'pending' as const },
        { index: 2, description: 'step 3', files: ['/src/a.ts'], status: 'pending' as const },
      ],
    };
    // Steps 0 and 1 are independent, so should coordinate
    expect(shouldCoordinate(state)).toBe(true);
  });
});
