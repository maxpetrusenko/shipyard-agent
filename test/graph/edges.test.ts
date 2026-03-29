import { describe, expect, it } from 'vitest';

import { afterGate, afterPlan, afterErrorRecovery } from '../../src/graph/edges.js';
import type { ShipyardStateType } from '../../src/graph/state.js';

function baseState(): ShipyardStateType {
  return {
    runId: 'run',
    traceId: 'trace',
    instruction: 'refactor app',
    phase: 'planning',
    steps: [{ index: 0, description: 'step', files: ['/repo/a.ts'], status: 'pending' }],
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
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
  };
}

describe('afterPlan', () => {
  it('routes planned code runs to coordinator by default', () => {
    expect(afterPlan(baseState())).toBe('coordinate');
  });

  it('falls back to execute when coordination is disabled', () => {
    expect(afterPlan({ ...baseState(), forceSequential: true })).toBe('execute');
  });
});

describe('afterGate', () => {
  it('routes supplied-plan runs straight to coordinator', () => {
    expect(afterGate({ ...baseState(), gateRoute: 'coordinate' })).toBe('coordinate');
  });

  it('routes recovery fallback runs straight to execute', () => {
    expect(afterGate({ ...baseState(), gateRoute: 'execute' })).toBe('execute');
  });
});

describe('afterErrorRecovery', () => {
  it('routes to plan when phase is planning', () => {
    expect(afterErrorRecovery({ ...baseState(), phase: 'planning' })).toBe('plan');
  });

  it('routes to execute when phase is executing (verification retry)', () => {
    expect(afterErrorRecovery({ ...baseState(), phase: 'executing' })).toBe('execute');
  });

  it('routes to report when phase is error (fatal)', () => {
    expect(afterErrorRecovery({ ...baseState(), phase: 'error' })).toBe('report');
  });

  it('routes to report for any other phase', () => {
    expect(afterErrorRecovery({ ...baseState(), phase: 'done' })).toBe('report');
    expect(afterErrorRecovery({ ...baseState(), phase: 'verifying' })).toBe('report');
  });
});
