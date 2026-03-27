/**
 * State annotation tests.
 *
 * Validates the shape and types of ShipyardState, supporting interfaces,
 * and type literals.
 */

import { describe, it, expect } from 'vitest';
import {
  ShipyardState,
  buildContextBlock,
  type ShipyardStateType,
  type ShipyardPhase,
  type PlanStep,
  type FileEdit,
  type ToolCallRecord,
  type VerificationResult,
  type ReviewDecision,
  type ContextEntry,
  type LLMMessage,
  type ExecuteDiagnostics,
  type ExecutionIssue,
  type ExecuteStopReason,
} from '../../src/graph/state.js';
import { checkPlanComplexity } from '../../src/graph/nodes/plan.js';

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

describe('ShipyardPhase', () => {
  it('accepts all valid phase values', () => {
    const phases: ShipyardPhase[] = [
      'idle',
      'planning',
      'executing',
      'verifying',
      'reviewing',
      'done',
      'error',
    ];
    expect(phases).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// PlanStep
// ---------------------------------------------------------------------------

describe('PlanStep', () => {
  it('has expected shape', () => {
    const step: PlanStep = {
      index: 0,
      description: 'Fix the bug',
      files: ['/src/foo.ts'],
      status: 'pending',
    };
    expect(step.index).toBe(0);
    expect(step.status).toBe('pending');
  });

  it('accepts all valid status values', () => {
    const statuses: PlanStep['status'][] = ['pending', 'in_progress', 'done', 'failed'];
    expect(statuses).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// FileEdit
// ---------------------------------------------------------------------------

describe('FileEdit', () => {
  it('has expected shape', () => {
    const edit: FileEdit = {
      file_path: '/src/index.ts',
      tier: 1,
      old_string: 'old',
      new_string: 'new',
      timestamp: Date.now(),
    };
    expect(edit.tier).toBe(1);
    expect(edit.file_path).toBe('/src/index.ts');
  });

  it('accepts all valid tier values', () => {
    const tiers: FileEdit['tier'][] = [1, 2, 3, 4];
    expect(tiers).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// ToolCallRecord
// ---------------------------------------------------------------------------

describe('ToolCallRecord', () => {
  it('has expected shape', () => {
    const record: ToolCallRecord = {
      tool_name: 'bash',
      tool_input: { command: 'echo hi' },
      tool_result: '{"success":true}',
      timestamp: Date.now(),
      duration_ms: 50,
    };
    expect(record.tool_name).toBe('bash');
    expect(record.duration_ms).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// VerificationResult
// ---------------------------------------------------------------------------

describe('VerificationResult', () => {
  it('has expected shape for passing result', () => {
    const result: VerificationResult = {
      passed: true,
      error_count: 0,
    };
    expect(result.passed).toBe(true);
    expect(result.error_count).toBe(0);
  });

  it('has expected shape for failing result', () => {
    const result: VerificationResult = {
      passed: false,
      typecheck_output: 'error TS2322: ...',
      test_output: 'FAIL src/test.ts',
      error_count: 5,
    };
    expect(result.passed).toBe(false);
    expect(result.error_count).toBe(5);
    expect(result.typecheck_output).toContain('TS2322');
  });
});

// ---------------------------------------------------------------------------
// ReviewDecision
// ---------------------------------------------------------------------------

describe('ReviewDecision', () => {
  it('accepts all valid decision values', () => {
    const decisions: ReviewDecision[] = ['continue', 'done', 'retry', 'escalate'];
    expect(decisions).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// ContextEntry
// ---------------------------------------------------------------------------

describe('ContextEntry', () => {
  it('has expected shape', () => {
    const entry: ContextEntry = {
      label: 'Coding Standards',
      content: 'Use TypeScript strict mode',
      source: 'user',
    };
    expect(entry.label).toBe('Coding Standards');
    expect(entry.source).toBe('user');
  });

  it('accepts all valid source values', () => {
    const sources: ContextEntry['source'][] = ['user', 'tool', 'system'];
    expect(sources).toHaveLength(3);
  });
});

describe('buildContextBlock', () => {
  it('returns empty string for no contexts', () => {
    expect(buildContextBlock([])).toBe('');
  });

  it('joins labeled sections with blank lines', () => {
    const out = buildContextBlock([
      { label: 'A', content: 'one', source: 'user' },
      { label: 'B', content: 'two', source: 'system' },
    ]);
    expect(out).toContain('## A');
    expect(out).toContain('one');
    expect(out).toContain('## B');
    expect(out).toContain('two');
  });
});

// ---------------------------------------------------------------------------
// LLMMessage
// ---------------------------------------------------------------------------

describe('LLMMessage', () => {
  it('has expected shape', () => {
    const msg: LLMMessage = {
      role: 'user',
      content: 'Please fix the bug',
    };
    expect(msg.role).toBe('user');
  });

  it('accepts all valid roles', () => {
    const roles: LLMMessage['role'][] = ['user', 'assistant', 'system'];
    expect(roles).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// ExecutionIssue
// ---------------------------------------------------------------------------

describe('ExecutionIssue', () => {
  it('has expected shape', () => {
    const issue: ExecutionIssue = {
      kind: 'guardrail',
      recoverable: true,
      message: 'Scope violation',
      nextAction: 'Retry with scoped edit',
      stopReason: 'guardrail_violation',
    };
    expect(issue.kind).toBe('guardrail');
    expect(issue.recoverable).toBe(true);
    expect(issue.stopReason).toBe('guardrail_violation');
  });

  it('accepts all valid kind values', () => {
    const kinds: ExecutionIssue['kind'][] = ['guardrail', 'watchdog', 'max_tool_rounds', 'coordination'];
    expect(kinds).toHaveLength(4);
  });

  it('accepts all ExecuteStopReason values', () => {
    const reasons: ExecuteStopReason[] = [
      'step_complete', 'validated_noop', 'stalled_no_edit_rounds',
      'guardrail_violation', 'max_tool_rounds',
    ];
    expect(reasons).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// VerificationResult extended fields
// ---------------------------------------------------------------------------

describe('VerificationResult extended fields', () => {
  it('accepts baseline diff fields', () => {
    const result: VerificationResult = {
      passed: false,
      error_count: 5,
      preExistingErrorCount: 3,
      newErrorCount: 2,
      baselineFingerprint: 'abc123',
    };
    expect(result.preExistingErrorCount).toBe(3);
    expect(result.newErrorCount).toBe(2);
    expect(result.baselineFingerprint).toBe('abc123');
  });

  it('is backward compatible without extended fields', () => {
    const result: VerificationResult = {
      passed: true,
      error_count: 0,
    };
    expect(result.preExistingErrorCount).toBeUndefined();
    expect(result.newErrorCount).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ExecuteDiagnostics
// ---------------------------------------------------------------------------

describe('ExecuteDiagnostics', () => {
  it('has expected shape', () => {
    const diag: ExecuteDiagnostics = {
      noEditToolRounds: 3,
      discoveryCallsBeforeFirstEdit: 6,
      lastBlockingReason: null,
      stopReason: 'step_complete',
    };
    expect(diag.noEditToolRounds).toBe(3);
    expect(diag.stopReason).toBe('step_complete');
  });
});

// ---------------------------------------------------------------------------
// ShipyardState annotation
// ---------------------------------------------------------------------------

describe('ShipyardState', () => {
  it('is defined as an annotation root', () => {
    expect(ShipyardState).toBeDefined();
  });

  it('produces a state type with expected keys', () => {
    // Type-level check: ensure ShipyardStateType has key fields
    const keys: Array<keyof ShipyardStateType> = [
      'runId',
      'traceId',
      'instruction',
      'phase',
      'steps',
      'currentStepIndex',
      'fileEdits',
      'toolCallHistory',
      'verificationResult',
      'reviewDecision',
      'reviewFeedback',
      'contexts',
      'messages',
      'error',
      'retryCount',
      'maxRetries',
      'tokenUsage',
      'traceUrl',
      'runStartedAt',
      'workerResults',
      'loopDiagnostics',
      'executeDiagnostics',
      'modelHint',
      'runMode',
      'gateRoute',
      'modelOverride',
      'modelFamily',
      'modelOverrides',
      'executionIssue',
    ];
    // If any of these didn't exist on the type, TS would error at compile time.
    // At runtime, just verify the array is populated.
    expect(keys.length).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Default state construction
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plan complexity warning
// ---------------------------------------------------------------------------

describe('checkPlanComplexity', () => {
  it('returns null for small plans', () => {
    const steps: PlanStep[] = Array.from({ length: 3 }, (_, i) => ({
      index: i,
      description: `step ${i}`,
      files: [`/src/file${i}.ts`],
      status: 'pending' as const,
    }));
    expect(checkPlanComplexity(steps)).toBeNull();
  });

  it('warns when steps exceed 7', () => {
    const steps: PlanStep[] = Array.from({ length: 8 }, (_, i) => ({
      index: i,
      description: `step ${i}`,
      files: [`/src/file${i}.ts`],
      status: 'pending' as const,
    }));
    const warning = checkPlanComplexity(steps);
    expect(warning).toContain('[Plan Warning]');
    expect(warning).toContain('8 steps');
  });

  it('warns when unique files exceed 20', () => {
    const files = Array.from({ length: 21 }, (_, i) => `/src/file${i}.ts`);
    const steps: PlanStep[] = [
      { index: 0, description: 'big step', files, status: 'pending' },
    ];
    const warning = checkPlanComplexity(steps);
    expect(warning).toContain('[Plan Warning]');
    expect(warning).toContain('21 files');
  });

  it('deduplicates files across steps', () => {
    const steps: PlanStep[] = [
      { index: 0, description: 's1', files: ['/src/a.ts', '/src/b.ts'], status: 'pending' },
      { index: 1, description: 's2', files: ['/src/a.ts', '/src/c.ts'], status: 'pending' },
    ];
    // 3 unique files, 2 steps — should not warn
    expect(checkPlanComplexity(steps)).toBeNull();
  });
});

describe('default state values', () => {
  it('can construct a valid minimal state object', () => {
    const state: ShipyardStateType = {
      runId: 'test-123',
      traceId: 'trace-abc',
      instruction: 'do something',
      phase: 'idle',
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
      modelHint: null,
      runMode: 'auto',
      gateRoute: 'plan',
      modelOverride: null,
      modelFamily: null,
      modelOverrides: null,
      executionIssue: null,
    };

    expect(state.runId).toBe('test-123');
    expect(state.phase).toBe('idle');
    expect(state.steps).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.retryCount).toBe(0);
    expect(state.maxRetries).toBe(3);
    expect(state.workerResults).toEqual([]);
  });
});
