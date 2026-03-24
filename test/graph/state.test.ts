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
} from '../../src/graph/state.js';

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
      'modelHint',
      'runMode',
      'gateRoute',
      'modelOverride',
      'modelFamily',
      'modelOverrides',
    ];
    // If any of these didn't exist on the type, TS would error at compile time.
    // At runtime, just verify the array is populated.
    expect(keys.length).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Default state construction
// ---------------------------------------------------------------------------

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
      modelHint: null,
      runMode: 'auto',
      gateRoute: 'plan',
      modelOverride: null,
      modelFamily: null,
      modelOverrides: null,
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
