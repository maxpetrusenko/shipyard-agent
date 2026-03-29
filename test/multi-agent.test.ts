import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { detectConflicts, mergeEdits } from '../src/multi-agent/merge.js';
import {
  shouldCoordinate,
  extractSubtaskFiles,
  markCompletedStepsFromWorkers,
} from '../src/graph/nodes/coordinate.js';
import type { WorkerResult } from '../src/multi-agent/worker.js';
import type { ShipyardStateType } from '../src/graph/state.js';
import {
  type SubTask,
  extractRelativePaths,
  enforceFileOwnership,
} from '../src/multi-agent/supervisor.js';

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
  const workFile = (...parts: string[]): string => resolve(process.cwd(), ...parts);
  const baseState: ShipyardStateType = {
    runId: 'test',
    traceId: 'trace',
    instruction: 'do stuff',
    phase: 'executing',
    steps: [],
    currentStepIndex: 0,
    currentStepEditBaseline: null,
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
    executionIssue: null,
    tokenUsage: null,
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    forceSequential: false,
    loopDiagnostics: null,
    executeDiagnostics: null,
    modelHint: 'opus',
    runMode: 'auto',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
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
        { index: 0, description: 'step 1', files: [workFile('api', 'a.ts')], status: 'pending' as const },
        { index: 1, description: 'step 2', files: [workFile('web', 'b.ts')], status: 'pending' as const },
        { index: 2, description: 'step 3', files: [workFile('docs', 'c.ts')], status: 'pending' as const },
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

  it('returns false when any file is owned by multiple steps', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: [workFile('api', 'a.ts')], status: 'pending' as const },
        { index: 1, description: 'step 2', files: [workFile('web', 'b.ts')], status: 'pending' as const },
        { index: 2, description: 'step 3', files: [workFile('api', 'a.ts')], status: 'pending' as const },
        { index: 3, description: 'step 4', files: [workFile('docs', 'c.ts')], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });

  it('returns false when multiple steps own the same top-level root', () => {
    const state = {
      ...baseState,
      steps: [
        { index: 0, description: 'step 1', files: [workFile('api', 'routes', 'files.ts')], status: 'pending' as const },
        { index: 1, description: 'step 2', files: [workFile('api', 'services', 'upload.ts')], status: 'pending' as const },
        { index: 2, description: 'step 3', files: [workFile('web', 'src', 'hooks', 'useCommentsQuery.ts')], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });

  it('returns false for strict single-file instructions', () => {
    const state = {
      ...baseState,
      instruction: 'Make exactly one file change and do not edit any other file.',
      steps: [
        { index: 0, description: 'step 1', files: ['/src/a.ts'], status: 'pending' as const },
        { index: 1, description: 'step 2', files: ['/src/b.ts'], status: 'pending' as const },
        { index: 2, description: 'step 3', files: ['/src/c.ts'], status: 'pending' as const },
      ],
    };
    expect(shouldCoordinate(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markCompletedStepsFromWorkers
// ---------------------------------------------------------------------------

describe('markCompletedStepsFromWorkers', () => {
  it('marks steps done when a successful worker claims overlapping files without edits', () => {
    const steps = [
      {
        index: 0,
        description: 'Wire upload tracker warning',
        files: ['/repo/src/services/uploadTracker.ts'],
        status: 'pending' as const,
      },
      {
        index: 1,
        description: 'Update editor integration',
        files: ['/repo/web/src/components/editor/DocumentEditor.tsx'],
        status: 'pending' as const,
      },
    ];
    const subtasks: SubTask[] = [
      {
        id: 'worker-1',
        description: 'Audit and confirm /repo/src/services/uploadTracker.ts already satisfies the contract.',
        files: ['/repo/src/services/uploadTracker.ts'],
      },
      {
        id: 'worker-2',
        description: 'Edit /repo/web/src/components/editor/DocumentEditor.tsx for comment wiring.',
        files: ['/repo/web/src/components/editor/DocumentEditor.tsx'],
      },
    ];
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'worker-1',
        phase: 'done',
        fileEdits: [],
      }),
      makeWorkerResult({
        subtaskId: 'worker-2',
        phase: 'done',
        fileEdits: [],
      }),
    ];

    const completed = markCompletedStepsFromWorkers(steps, subtasks, results);
    expect(completed[0]!.status).toBe('done');
    expect(completed[1]!.status).toBe('done');
  });

  it('does not mark steps done from failed workers', () => {
    const steps = [
      {
        index: 0,
        description: 'Wire comments hook',
        files: ['/repo/src/hooks/useCommentsQuery.ts'],
        status: 'pending' as const,
      },
    ];
    const subtasks: SubTask[] = [
      {
        id: 'worker-1',
        description: 'Inspect /repo/src/hooks/useCommentsQuery.ts',
        files: ['/repo/src/hooks/useCommentsQuery.ts'],
      },
    ];
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'worker-1',
        phase: 'error',
        error: 'blocked',
      }),
    ];

    const completed = markCompletedStepsFromWorkers(steps, subtasks, results);
    expect(completed[0]!.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// extractSubtaskFiles
// ---------------------------------------------------------------------------

describe('extractSubtaskFiles', () => {
  it('extracts absolute file paths from subtask description', () => {
    const desc = 'Edit /src/graph/nodes/verify.ts and /src/graph/state.ts to add types.';
    const files = extractSubtaskFiles(desc);
    expect(files).toContain('/src/graph/nodes/verify.ts');
    expect(files).toContain('/src/graph/state.ts');
    expect(files).toHaveLength(2);
  });

  it('returns empty for descriptions without paths', () => {
    const desc = 'Add error handling to the coordinator node.';
    expect(extractSubtaskFiles(desc)).toHaveLength(0);
  });

  it('deduplicates repeated paths', () => {
    const desc = 'Read /src/a.ts then edit /src/a.ts to fix the bug.';
    const files = extractSubtaskFiles(desc);
    expect(files).toEqual(['/src/a.ts']);
  });
});

// ---------------------------------------------------------------------------
// forceSequential — regression tests for merge-conflict fallback
// ---------------------------------------------------------------------------

describe('forceSequential fallback', () => {
  const workFile = (...parts: string[]): string => resolve(process.cwd(), ...parts);
  const baseState: ShipyardStateType = {
    runId: 'test',
    traceId: 'trace',
    instruction: 'do stuff',
    phase: 'executing',
    steps: [],
    currentStepIndex: 0,
    currentStepEditBaseline: null,
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
    executionIssue: null,
    tokenUsage: null,
    traceUrl: null,
    runStartedAt: Date.now(),
    fileOverlaySnapshots: null,
    estimatedCost: null,
    workerResults: [],
    forceSequential: false,
    loopDiagnostics: null,
    executeDiagnostics: null,
    modelHint: 'opus',
    runMode: 'auto',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
  };

  it('shouldCoordinate returns false when forceSequential is true', () => {
    const state = {
      ...baseState,
      forceSequential: true,
      steps: [
        { index: 0, description: 'step 1', files: [workFile('api', 'a.ts')], status: 'pending' as const },
        { index: 1, description: 'step 2', files: [workFile('web', 'b.ts')], status: 'pending' as const },
        { index: 2, description: 'step 3', files: [workFile('docs', 'c.ts')], status: 'pending' as const },
      ],
    };
    // These steps would normally coordinate (independent files in different roots)
    expect(shouldCoordinate({ ...state, forceSequential: false })).toBe(true);
    // But forceSequential blocks it
    expect(shouldCoordinate(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractRelativePaths — supervisor file detection
// ---------------------------------------------------------------------------

describe('extractRelativePaths', () => {
  it('extracts relative file paths from descriptions', () => {
    const desc = 'Edit routes/files.ts and src/services/auth.ts to wire up the handler.';
    const paths = extractRelativePaths(desc);
    expect(paths).toContain('routes/files.ts');
    expect(paths).toContain('src/services/auth.ts');
  });

  it('extracts backtick-wrapped paths', () => {
    const desc = 'Modify `api/src/routes/files.ts` for upload support.';
    const paths = extractRelativePaths(desc);
    expect(paths).toContain('api/src/routes/files.ts');
  });

  it('ignores URLs', () => {
    const desc = 'See http://example.com/path/to/file.ts for reference.';
    const paths = extractRelativePaths(desc);
    expect(paths).toHaveLength(0);
  });

  it('returns empty for descriptions without paths', () => {
    const desc = 'Add error handling to the coordinator node.';
    expect(extractRelativePaths(desc)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// enforceFileOwnership — same-file collision regression (files.ts case)
// ---------------------------------------------------------------------------

describe('enforceFileOwnership', () => {
  it('auto-detects shared files from descriptions and serializes tasks', () => {
    const subtasks: SubTask[] = [
      { id: '1', description: 'Add upload endpoint to routes/files.ts', files: [] },
      { id: '2', description: 'Add download endpoint to routes/files.ts', files: [] },
    ];
    const result = enforceFileOwnership(subtasks, []);

    // Both tasks should now have routes/files.ts in their files[]
    expect(result.subtasks[0]!.files).toContain('routes/files.ts');
    expect(result.subtasks[1]!.files).toContain('routes/files.ts');

    // Auto-serialized since they share a file
    expect(result.sequentialPairs).toHaveLength(1);
    expect(result.sequentialPairs[0]).toEqual(['1', '2']);
  });

  it('preserves existing files and sequential pairs', () => {
    const subtasks: SubTask[] = [
      { id: '1', description: 'Edit src/a.ts', files: ['/existing/b.ts'] },
      { id: '2', description: 'Edit src/c.ts', files: [] },
    ];
    const result = enforceFileOwnership(subtasks, [['1', '2']]);

    // Existing file preserved + new one added
    expect(result.subtasks[0]!.files).toContain('/existing/b.ts');
    expect(result.subtasks[0]!.files).toContain('src/a.ts');

    // Existing pair preserved
    expect(result.sequentialPairs).toContainEqual(['1', '2']);
  });

  it('does not duplicate sequential pairs', () => {
    const subtasks: SubTask[] = [
      { id: '1', description: 'Edit routes/files.ts', files: ['routes/files.ts'] },
      { id: '2', description: 'Edit routes/files.ts', files: ['routes/files.ts'] },
    ];
    // Already declared as sequential
    const result = enforceFileOwnership(subtasks, [['1', '2']]);
    expect(result.sequentialPairs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeEdits — silent drop guard for disjoint edits
// ---------------------------------------------------------------------------

describe('mergeEdits — disjoint multi-worker', () => {
  it('keeps all edits when 3 workers touch same file with disjoint regions plus independent files', () => {
    const results: WorkerResult[] = [
      makeWorkerResult({
        subtaskId: 'w1',
        fileEdits: [
          { file_path: '/shared.ts', tier: 1, old_string: 'const HEADER = "old";', new_string: 'const HEADER = "new";', timestamp: 1 },
          { file_path: '/independent-a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 2 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w2',
        fileEdits: [
          { file_path: '/shared.ts', tier: 1, old_string: 'const FOOTER = "old";', new_string: 'const FOOTER = "new";', timestamp: 3 },
        ],
      }),
      makeWorkerResult({
        subtaskId: 'w3',
        fileEdits: [
          { file_path: '/independent-b.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 4 },
        ],
      }),
    ];

    const conflicts = detectConflicts(results);
    // shared.ts conflict is non-overlapping (disjoint regions)
    const sharedConflict = conflicts.find((c) => c.filePath === '/shared.ts');
    expect(sharedConflict).toBeDefined();
    expect(sharedConflict!.type).toBe('non_overlapping');

    const { merged, needsReplan } = mergeEdits(results, conflicts);
    // All 4 edits should be kept (2 disjoint on shared + 2 independent)
    expect(merged).toHaveLength(4);
    expect(needsReplan).toHaveLength(0);

    const paths = merged.map((e) => e.file_path);
    expect(paths.filter((p) => p === '/shared.ts')).toHaveLength(2);
    expect(paths).toContain('/independent-a.ts');
    expect(paths).toContain('/independent-b.ts');
  });
});
