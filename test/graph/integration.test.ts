/**
 * Full graph integration test.
 *
 * Compiles the real StateGraph via createShipyardGraph but replaces
 * all node implementations with lightweight state transformers.
 * This tests the edge routing + state transitions through the full pipeline
 * without requiring real LLM calls, file I/O, or network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShipyardStateType, PlanStep } from '../../src/graph/state.js';

// ---------------------------------------------------------------------------
// Mock all nodes with minimal state transformers
// ---------------------------------------------------------------------------

const gateImpl = vi.fn();
const planImpl = vi.fn();
const executeImpl = vi.fn();
const coordinateImpl = vi.fn();
const verifyImpl = vi.fn();
const reviewImpl = vi.fn();
const errorRecoveryImpl = vi.fn();
const reportImpl = vi.fn();

vi.mock('../../src/graph/nodes/gate.js', () => ({
  gateNode: (...args: unknown[]) => gateImpl(...args),
}));
vi.mock('../../src/graph/nodes/plan.js', () => ({
  planNode: (...args: unknown[]) => planImpl(...args),
}));
vi.mock('../../src/graph/nodes/execute.js', () => ({
  executeNode: (...args: unknown[]) => executeImpl(...args),
}));
vi.mock('../../src/graph/nodes/coordinate.js', () => ({
  coordinateNode: (...args: unknown[]) => coordinateImpl(...args),
}));
vi.mock('../../src/graph/nodes/verify.js', () => ({
  verifyNode: (...args: unknown[]) => verifyImpl(...args),
}));
vi.mock('../../src/graph/nodes/review.js', () => ({
  reviewNode: (...args: unknown[]) => reviewImpl(...args),
}));
vi.mock('../../src/graph/nodes/error-recovery.js', () => ({
  errorRecoveryNode: (...args: unknown[]) => errorRecoveryImpl(...args),
}));
vi.mock('../../src/graph/nodes/report.js', () => ({
  reportNode: (...args: unknown[]) => reportImpl(...args),
}));

import { createShipyardGraph } from '../../src/graph/builder.js';

function makeStep(index: number, status: PlanStep['status'] = 'pending'): PlanStep {
  return { index, description: `step ${index}`, files: [`/repo/file${index}.ts`], status };
}

function baseInput(): Record<string, unknown> {
  return {
    runId: 'test-run',
    traceId: 'test-trace',
    instruction: 'refactor auth module',
    phase: 'idle',
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
    maxRetries: 8,
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
    modelHint: null,
    runMode: 'code',
    gateRoute: 'plan',
    modelOverride: null,
    modelFamily: null,
    modelOverrides: null,
  };
}

async function runGraph(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const graph = createShipyardGraph();
  let finalState: Record<string, unknown> = {};
  for await (const chunk of await graph.stream(input, {
    recursionLimit: 50,
  })) {
    // Each chunk is { nodeName: partialState }
    for (const [, partial] of Object.entries(chunk)) {
      finalState = { ...finalState, ...partial };
    }
  }
  return finalState;
}

describe('Graph integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: gate → plan → coordinate → verify → review → report', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });
    planImpl.mockReturnValue({
      phase: 'executing',
      steps: [makeStep(0), makeStep(1), makeStep(2)],
      currentStepIndex: 0,
      modelHint: 'sonnet',
    });
    // 3 steps + not forceSequential → afterPlan routes to coordinate
    coordinateImpl.mockReturnValue({
      phase: 'verifying',
      steps: [makeStep(0, 'done'), makeStep(1, 'done'), makeStep(2, 'done')],
      fileEdits: [{ file_path: '/repo/file0.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 }],
    });
    verifyImpl.mockReturnValue({
      phase: 'reviewing',
      verificationResult: { passed: true, error_count: 0, newErrorCount: 0 },
    });
    reviewImpl.mockReturnValue({
      phase: 'done',
      reviewDecision: 'done',
    });
    reportImpl.mockReturnValue({
      traceUrl: 'https://trace.example.com',
    });

    const result = await runGraph(baseInput());

    expect(gateImpl).toHaveBeenCalledTimes(1);
    expect(planImpl).toHaveBeenCalledTimes(1);
    expect(coordinateImpl).toHaveBeenCalledTimes(1);
    expect(executeImpl).not.toHaveBeenCalled(); // coordinator path, not execute
    expect(verifyImpl).toHaveBeenCalledTimes(1);
    expect(reviewImpl).toHaveBeenCalledTimes(1);
    expect(reportImpl).toHaveBeenCalledTimes(1);
    expect(result.reviewDecision).toBe('done');
    expect(result.traceUrl).toBe('https://trace.example.com');
  });

  it('forceSequential routes plan → execute (not coordinate)', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });
    planImpl.mockReturnValue({
      phase: 'executing',
      steps: [makeStep(0), makeStep(1), makeStep(2)],
      currentStepIndex: 0,
      forceSequential: true,
      modelHint: 'sonnet',
    });
    executeImpl.mockReturnValue({
      phase: 'verifying',
      steps: [makeStep(0, 'done'), makeStep(1), makeStep(2)],
    });
    verifyImpl.mockReturnValue({
      phase: 'reviewing',
      verificationResult: { passed: true, error_count: 0 },
    });
    reviewImpl.mockReturnValue({
      phase: 'done',
      reviewDecision: 'done',
    });
    reportImpl.mockReturnValue({});

    await runGraph(baseInput());

    expect(coordinateImpl).not.toHaveBeenCalled();
    expect(executeImpl).toHaveBeenCalledTimes(1);
  });

  it('skips plan node when gate returns a supplied execution plan', async () => {
    gateImpl.mockReturnValue({
      gateRoute: 'coordinate',
      phase: 'executing',
      steps: [makeStep(0), makeStep(1)],
      currentStepIndex: 0,
    });
    coordinateImpl.mockReturnValue({
      phase: 'verifying',
      steps: [makeStep(0, 'done'), makeStep(1, 'done')],
    });
    verifyImpl.mockReturnValue({
      phase: 'reviewing',
      verificationResult: { passed: true, error_count: 0, newErrorCount: 0 },
    });
    reviewImpl.mockReturnValue({
      phase: 'done',
      reviewDecision: 'done',
    });
    reportImpl.mockReturnValue({});

    await runGraph(baseInput());

    expect(planImpl).not.toHaveBeenCalled();
    expect(coordinateImpl).toHaveBeenCalledTimes(1);
    expect(executeImpl).not.toHaveBeenCalled();
  });

  it('review retry → plan → coordinate → verify → review → done', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });

    let planCallCount = 0;
    planImpl.mockImplementation(() => {
      planCallCount++;
      return {
        phase: 'executing',
        steps: [makeStep(0), makeStep(1), makeStep(2)],
        currentStepIndex: 0,
        modelHint: 'sonnet',
      };
    });

    coordinateImpl.mockReturnValue({
      phase: 'verifying',
      steps: [makeStep(0, 'done'), makeStep(1, 'done'), makeStep(2, 'done')],
      fileEdits: [{ file_path: '/repo/a.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 1 }],
    });

    let verifyCount = 0;
    verifyImpl.mockImplementation(() => {
      verifyCount++;
      return {
        phase: 'reviewing',
        verificationResult: verifyCount === 1
          ? { passed: false, error_count: 2, newErrorCount: 2 }
          : { passed: true, error_count: 0, newErrorCount: 0 },
      };
    });

    let reviewCount = 0;
    reviewImpl.mockImplementation(() => {
      reviewCount++;
      if (reviewCount === 1) {
        return {
          phase: 'planning',
          reviewDecision: 'retry',
          reviewFeedback: 'Fix type errors',
          retryCount: 1,
        };
      }
      return {
        phase: 'done',
        reviewDecision: 'done',
      };
    });

    reportImpl.mockReturnValue({});

    const result = await runGraph(baseInput());

    expect(planImpl).toHaveBeenCalledTimes(2); // initial + retry
    expect(coordinateImpl).toHaveBeenCalledTimes(2);
    expect(verifyImpl).toHaveBeenCalledTimes(2);
    expect(reviewImpl).toHaveBeenCalledTimes(2);
    expect(result.reviewDecision).toBe('done');
  });

  it('review escalate → error_recovery → plan (retry)', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });
    planImpl.mockReturnValue({
      phase: 'executing',
      steps: [makeStep(0), makeStep(1), makeStep(2)],
      currentStepIndex: 0,
      modelHint: 'sonnet',
    });
    coordinateImpl.mockReturnValue({
      phase: 'verifying',
      steps: [makeStep(0, 'done'), makeStep(1, 'done'), makeStep(2, 'done')],
    });
    verifyImpl.mockReturnValue({
      phase: 'reviewing',
      verificationResult: { passed: false, error_count: 100, newErrorCount: 100 },
    });

    let reviewCount = 0;
    reviewImpl.mockImplementation(() => {
      reviewCount++;
      if (reviewCount === 1) {
        return {
          phase: 'error',
          reviewDecision: 'escalate',
          error: 'Too many errors',
        };
      }
      // Second review after recovery → done
      return {
        phase: 'done',
        reviewDecision: 'done',
      };
    });

    // error_recovery retries to planning
    errorRecoveryImpl.mockReturnValue({
      phase: 'planning',
      retryCount: 1,
      error: null,
      reviewFeedback: 'Retrying after escalation',
      modelHint: 'opus',
    });

    // After re-plan on second pass, verify passes
    let verifyCount = 0;
    verifyImpl.mockImplementation(() => {
      verifyCount++;
      return {
        phase: 'reviewing',
        verificationResult: verifyCount === 1
          ? { passed: false, error_count: 100, newErrorCount: 100 }
          : { passed: true, error_count: 0, newErrorCount: 0 },
      };
    });

    reportImpl.mockReturnValue({});

    const result = await runGraph(baseInput());

    expect(errorRecoveryImpl).toHaveBeenCalledTimes(1);
    expect(planImpl).toHaveBeenCalledTimes(2); // initial + after recovery
    expect(result.reviewDecision).toBe('done');
  });

  it('error_recovery routes to execute when phase=executing (G3 fix)', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });
    planImpl.mockReturnValue({
      phase: 'executing',
      steps: [makeStep(0)],
      currentStepIndex: 0,
      forceSequential: true,
      modelHint: 'sonnet',
    });

    let execCount = 0;
    executeImpl.mockImplementation(() => {
      execCount++;
      return {
        phase: 'verifying',
        steps: [makeStep(0, execCount > 1 ? 'done' : 'failed')],
      };
    });

    let verifyCount = 0;
    verifyImpl.mockImplementation(() => {
      verifyCount++;
      return {
        phase: 'reviewing',
        verificationResult: verifyCount === 1
          ? { passed: false, error_count: 3, newErrorCount: 3 }
          : { passed: true, error_count: 0, newErrorCount: 0 },
      };
    });

    let reviewCount = 0;
    reviewImpl.mockImplementation(() => {
      reviewCount++;
      if (reviewCount === 1) {
        return {
          phase: 'error',
          reviewDecision: 'escalate',
          error: 'Verification failed',
        };
      }
      return { phase: 'done', reviewDecision: 'done' };
    });

    // Key: error_recovery returns phase='executing' — should route to execute, not report
    errorRecoveryImpl.mockReturnValue({
      phase: 'executing',
      retryCount: 1,
      error: null,
      reviewFeedback: 'Re-executing with fixes',
      modelHint: 'opus',
    });

    reportImpl.mockReturnValue({});

    const result = await runGraph(baseInput());

    expect(errorRecoveryImpl).toHaveBeenCalledTimes(1);
    // Execute called twice: initial + after error_recovery routes to execute
    expect(executeImpl).toHaveBeenCalledTimes(2);
    expect(planImpl).toHaveBeenCalledTimes(1); // NOT re-planned
    expect(result.reviewDecision).toBe('done');
  });

  it('Q&A gate route ends immediately without planning', async () => {
    gateImpl.mockReturnValue({
      gateRoute: 'end',
      phase: 'done',
      messages: [{ role: 'assistant', content: 'The answer is 42.' }],
    });

    const result = await runGraph({ ...baseInput(), runMode: 'chat' });

    expect(gateImpl).toHaveBeenCalledTimes(1);
    expect(planImpl).not.toHaveBeenCalled();
    expect(executeImpl).not.toHaveBeenCalled();
    expect(reportImpl).not.toHaveBeenCalled();
    expect(result.gateRoute).toBe('end');
  });

  it('review continue → execute next step (not re-plan)', async () => {
    gateImpl.mockReturnValue({ gateRoute: 'plan', phase: 'planning' });
    planImpl.mockReturnValue({
      phase: 'executing',
      steps: [makeStep(0), makeStep(1)],
      currentStepIndex: 0,
      forceSequential: true,
      modelHint: 'sonnet',
    });

    let execCount = 0;
    executeImpl.mockImplementation(() => {
      execCount++;
      return {
        phase: 'verifying',
        steps: execCount === 1
          ? [makeStep(0, 'done'), makeStep(1)]
          : [makeStep(0, 'done'), makeStep(1, 'done')],
        currentStepIndex: execCount === 1 ? 0 : 1,
      };
    });

    verifyImpl.mockReturnValue({
      phase: 'reviewing',
      verificationResult: { passed: true, error_count: 0, newErrorCount: 0 },
    });

    let reviewCount = 0;
    reviewImpl.mockImplementation(() => {
      reviewCount++;
      if (reviewCount === 1) {
        return {
          phase: 'executing',
          reviewDecision: 'continue',
          currentStepIndex: 1,
        };
      }
      return { phase: 'done', reviewDecision: 'done' };
    });

    reportImpl.mockReturnValue({});

    const result = await runGraph(baseInput());

    expect(executeImpl).toHaveBeenCalledTimes(2); // step 0 + step 1
    expect(planImpl).toHaveBeenCalledTimes(1); // no re-plan
    expect(result.reviewDecision).toBe('done');
  });
});
