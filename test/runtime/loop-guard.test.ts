import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialLoopDiagnostics,
  createLoopGuard,
  formatLoopStopError,
  isGraphRecursionLimitError,
  resolveGraphRecursionLimit,
  resolveGraphSoftBudget,
  withHardRecursionStop,
} from '../../src/runtime/loop-guard.js';
import type { ShipyardStateType } from '../../src/graph/state.js';

function minimalState(overrides?: Partial<ShipyardStateType>): ShipyardStateType {
  return {
    runId: 'test-run',
    traceId: 'test-trace',
    instruction: 'test',
    phase: 'planning',
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
    loopDiagnostics: null,
    executeDiagnostics: null,
    executionIssue: null,
    modelHint: null,
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
    ...overrides,
  } as ShipyardStateType;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveGraphRecursionLimit', () => {
  it('returns 150 by default', () => {
    expect(resolveGraphRecursionLimit()).toBe(150);
  });

  it('reads SHIPYARD_GRAPH_RECURSION_LIMIT env var', () => {
    vi.stubEnv('SHIPYARD_GRAPH_RECURSION_LIMIT', '200');
    expect(resolveGraphRecursionLimit()).toBe(200);
  });

  it('clamps to minimum 32', () => {
    vi.stubEnv('SHIPYARD_GRAPH_RECURSION_LIMIT', '10');
    expect(resolveGraphRecursionLimit()).toBe(32);
  });

  it('clamps to maximum 400', () => {
    vi.stubEnv('SHIPYARD_GRAPH_RECURSION_LIMIT', '999');
    expect(resolveGraphRecursionLimit()).toBe(400);
  });

  it('ignores invalid env values', () => {
    vi.stubEnv('SHIPYARD_GRAPH_RECURSION_LIMIT', 'abc');
    expect(resolveGraphRecursionLimit()).toBe(150);
  });
});

describe('resolveGraphSoftBudget', () => {
  it('returns 120 for default recursion limit', () => {
    expect(resolveGraphSoftBudget(150)).toBe(120);
  });

  it('caps at recursionLimit - 1', () => {
    expect(resolveGraphSoftBudget(50)).toBe(49);
  });

  it('reads SHIPYARD_GRAPH_SOFT_BUDGET env var', () => {
    vi.stubEnv('SHIPYARD_GRAPH_SOFT_BUDGET', '80');
    expect(resolveGraphSoftBudget(150)).toBe(80);
  });

  it('clamps to minimum 12', () => {
    vi.stubEnv('SHIPYARD_GRAPH_SOFT_BUDGET', '5');
    expect(resolveGraphSoftBudget(150)).toBe(12);
  });
});

describe('createLoopGuard — dynamic soft budget', () => {
  it('scales budget with step count: 16 + steps*6 + retries*4', () => {
    const state = minimalState({
      steps: Array.from({ length: 10 }, (_, i) => ({
        index: i,
        description: `step ${i}`,
        files: [],
        status: 'pending' as const,
      })),
      maxRetries: 3,
    });

    const guard = createLoopGuard({
      recursionLimit: 150,
      softBudget: 30, // low base to verify dynamic override
      initialState: state,
      useDynamicSoftBudget: true,
    });

    // Observe one transition so dynamic budget is computed
    const nextState = minimalState({
      ...state,
      phase: 'executing',
    } as any);
    const diag = guard.observe(state, nextState);

    // Expected: max(30, 16 + 10*6 + 3*4) = max(30, 88) = 88
    expect(diag.graphSoftBudget).toBe(88);
  });

  it('uses base soft budget when dynamic is lower', () => {
    const state = minimalState({
      steps: [{ index: 0, description: 'one step', files: [], status: 'pending' as const }],
      maxRetries: 1,
    });

    const guard = createLoopGuard({
      recursionLimit: 150,
      softBudget: 120, // high base
      initialState: state,
      useDynamicSoftBudget: true,
    });

    const nextState = minimalState({ ...state, phase: 'executing' } as any);
    const diag = guard.observe(state, nextState);

    // Expected: max(120, 16 + 1*6 + 1*4) = max(120, 26) = 120
    expect(diag.graphSoftBudget).toBe(120);
  });

  it('disables dynamic budget when useDynamicSoftBudget is false', () => {
    const state = minimalState({
      steps: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        description: `step ${i}`,
        files: [],
        status: 'pending' as const,
      })),
      maxRetries: 5,
    });

    const guard = createLoopGuard({
      recursionLimit: 150,
      softBudget: 50,
      initialState: state,
      useDynamicSoftBudget: false,
    });

    const nextState = minimalState({ ...state, phase: 'executing' } as any);
    const diag = guard.observe(state, nextState);

    // Should use base, not dynamic (16 + 20*6 + 5*4 = 156 → clamped to 149)
    expect(diag.graphSoftBudget).toBe(50);
  });
});

describe('createLoopGuard — no-progress detection', () => {
  it('fires soft_budget_exceeded when step count hits budget', () => {
    const state = minimalState();
    const guard = createLoopGuard({
      recursionLimit: 150,
      softBudget: 3,
      initialState: state,
      useDynamicSoftBudget: false,
    });

    let diag = guard.current();
    for (let i = 0; i < 3; i++) {
      const next = minimalState({
        phase: 'executing',
        currentStepIndex: i,
        fileEdits: [{ file_path: `f${i}.ts`, tier: 1, old_string: 'a', new_string: 'b', timestamp: i }] as any,
      });
      diag = guard.observe(state, next);
    }

    expect(diag.stopReason).toBe('soft_budget_exceeded');
    expect(diag.graphStepCount).toBe(3);
  });

  it('detects repeated identical transitions without progress', () => {
    const state = minimalState({ phase: 'reviewing' });
    const guard = createLoopGuard({
      recursionLimit: 150,
      softBudget: 120,
      initialState: state,
      useDynamicSoftBudget: false,
    });

    // Same transition 4 times with no file edits or tool outcomes
    for (let i = 0; i < 4; i++) {
      guard.observe(
        minimalState({ phase: 'reviewing' }),
        minimalState({ phase: 'planning' }),
      );
    }

    const diag = guard.current();
    expect(diag.stopReason).toBe('no_progress');
    expect(diag.noProgressReason).toContain('Repeated identical phase transition');
  });
});

describe('isGraphRecursionLimitError', () => {
  it('detects GraphRecursionError by name', () => {
    const err = new Error('limit reached');
    err.name = 'GraphRecursionError';
    expect(isGraphRecursionLimitError(err)).toBe(true);
  });

  it('detects recursion limit by message pattern', () => {
    expect(
      isGraphRecursionLimitError(new Error('Recursion limit of 150 reached without hitting a stop condition')),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isGraphRecursionLimitError(new Error('TypeError'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isGraphRecursionLimitError('string error')).toBe(false);
    expect(isGraphRecursionLimitError(null)).toBe(false);
  });
});

describe('withHardRecursionStop', () => {
  it('sets hard_recursion_limit stop reason', () => {
    const diag = withHardRecursionStop(null, 150);
    expect(diag.stopReason).toBe('hard_recursion_limit');
    expect(diag.recursionLimit).toBe(150);
  });

  it('preserves existing noProgressReason when available', () => {
    const existing = createInitialLoopDiagnostics({ recursionLimit: 150, softBudget: 120 });
    existing.noProgressReason = 'Stuck in loop';
    const diag = withHardRecursionStop(existing, 150);
    expect(diag.noProgressReason).toBe('Stuck in loop');
    expect(diag.stopReason).toBe('hard_recursion_limit');
  });
});

describe('formatLoopStopError', () => {
  it('includes stop reason and step count', () => {
    const diag = createInitialLoopDiagnostics({ recursionLimit: 150, softBudget: 120 });
    diag.stopReason = 'soft_budget_exceeded';
    diag.graphStepCount = 120;
    const msg = formatLoopStopError(diag);
    expect(msg).toContain('soft graph budget');
    expect(msg).toContain('step_count=120');
    expect(msg).toContain('stop_reason=soft_budget_exceeded');
  });
});
