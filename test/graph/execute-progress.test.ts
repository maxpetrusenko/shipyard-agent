import { describe, expect, it } from 'vitest';
import {
  buildAmbiguousEditRecoveryNudge,
  buildDeterministicBlockerGuidance,
  createExecutionIssue,
  decideNoEditProgressAction,
  deriveBlockerCode,
  formatExecuteWatchdogError,
  hasNoEditJustification,
  isDeterministicNoProgressBlocker,
  parseExecuteDiagnosticsFromError,
  resolveEditsInCurrentExecuteStep,
  shouldTreatCompletionAsNoEdit,
  shouldFastTrackNoEditStall,
} from '../../src/graph/nodes/execute-progress.js';
import {
  capToolHistory,
  detectRepeatedToolCallLoop,
  MAX_TOOL_HISTORY,
} from '../../src/graph/nodes/execute.js';

describe('decideNoEditProgressAction', () => {
  it('nudges instead of hard-failing when prior-step edits exist but this step has none', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 0,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 14,
      discoveryCallLimit: null,
      stepDescription:
        "If a contributions page component exists, add a visible 'Hello world' line.",
      lastBlockingReason: null,
    });

    expect(action.kind).toBe('nudge');
  });

  it('concludes validated no-op for conditional steps after forced edit recovery is exhausted', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 12,
      discoveryCallLimit: 10,
      stepDescription:
        "If a contributions page component exists under a different path, add one 'Hello world' line.",
      lastBlockingReason: null,
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('conditional');
    }
  });

  it('concludes validated no-op for preserve-only steps after repeated premature completion', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 3,
      discoveryCallLimit: 2,
      stepDescription:
        'Update the audit logging helper only as needed to support auth/session flows while preserving its existing export shape.',
      lastBlockingReason:
        'STEP_COMPLETE without any successful edit or NO_EDIT_JUSTIFIED evidence',
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('conditional');
    }
  });

  it('treats as-needed compatibility steps as conditional preserve-only work', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 2,
      maxForcedEditNudges: 2,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 4,
      discoveryCallLimit: 3,
      stepDescription:
        'Update the audit logging helper as needed so auth and token lifecycle events can be logged consistently to audit_logs with request metadata and without breaking callers that already depend on the helper.',
      lastBlockingReason:
        'STEP_COMPLETE without any successful edit or NO_EDIT_JUSTIFIED evidence',
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('conditional');
    }
  });

  it('concludes validated no-op after identical edit no-op plus detailed same-file completion summary', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 0,
      discoveryCallLimit: null,
      stepDescription:
        'Update the API token CRUD routes to align with secure token lifecycle handling and standardized error responses.',
      stepFiles: ['/repo/api/src/routes/api-tokens.ts'],
      assistantText:
        'Implemented the API token route hardening and lifecycle updates in `/repo/api/src/routes/api-tokens.ts`:\n\n- Secure token generation with a ship_ prefix and SHA-256 hashing\n- Added standardized error response helper\n- Added audit logging for create/revoke actions\n\nSTEP_COMPLETE',
      lastBlockingReason: 'edit_file: old_string and new_string are identical',
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('repeated identical edit attempts');
    }
  });

  it('does not auto-close narrated completion when it does not mention the scoped file', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 0,
      discoveryCallLimit: null,
      stepDescription: 'Update the API token CRUD routes.',
      stepFiles: ['/repo/api/src/routes/api-tokens.ts'],
      assistantText:
        'Implemented the requested hardening:\n\n- Secure token generation\n- Standardized errors\n- Added audit logging\n\nSTEP_COMPLETE',
      lastBlockingReason: 'edit_file: old_string and new_string are identical',
    });

    expect(action.kind).toBe('stall');
  });

  it('concludes validated no-op from read-backed evidence after repeated bare completion', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 3,
      discoveryCallLimit: 2,
      stepDescription:
        'Implement the full authentication middleware behavior with revoked checks, workspace membership verification, sliding session refresh, and request augmentation with userId workspaceId isSuperAdmin isApiToken sessionId.',
      stepFiles: ['/repo/api/src/middleware/auth.ts'],
      readBackedSatisfied: true,
      lastBlockingReason:
        'STEP_COMPLETE without any successful edit or NO_EDIT_JUSTIFIED evidence',
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('read-backed evidence');
    }
  });

  it('concludes validated no-op from read-backed evidence after identical edit no-op', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 0,
      discoveryCallLimit: null,
      stepDescription:
        'Finish and harden the API token CRUD route so it interoperates with Bearer-token auth, workspace-scoped ownership checks, audit logging, and the shared error contract.',
      stepFiles: [
        '/repo/api/src/routes/api-tokens.ts',
        '/repo/api/src/services/audit.ts',
        '/repo/shared/src/constants.ts',
      ],
      readBackedSatisfied: true,
      lastBlockingReason: 'edit_file: old_string and new_string are identical',
    });

    expect(action.kind).toBe('validated_noop');
    if (action.kind === 'validated_noop') {
      expect(action.reason).toContain('redundant no-op');
    }
  });

  it('stalls with actionable diagnostics when no-edit rounds persist on required-edit steps', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 1,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 9,
      discoveryCallLimit: 8,
      stepDescription: 'Add Hello world to src/pages/Contributions.tsx',
      lastBlockingReason: 'Refusing edit outside explicit targets: /tmp/random.ts',
    });

    expect(action.kind).toBe('stall');
    if (action.kind === 'stall') {
      expect(action.nextAction).toContain('edit_file');
      const msg = formatExecuteWatchdogError(action.diagnostics, action.nextAction);
      expect(msg).toContain('Next action:');
      expect(msg).toContain('"noEditToolRounds":8');
      const parsed = parseExecuteDiagnosticsFromError(msg);
      expect(parsed).toEqual(action.diagnostics);
    }
  });
});

describe('createExecutionIssue', () => {
  it('creates a guardrail issue with default recoverable=true', () => {
    const issue = createExecutionIssue({
      kind: 'guardrail',
      message: 'Scope violation',
      nextAction: 'Retry',
      stopReason: 'guardrail_violation',
    });
    expect(issue.kind).toBe('guardrail');
    expect(issue.recoverable).toBe(true);
    expect(issue.stopReason).toBe('guardrail_violation');
  });

  it('creates a non-recoverable issue when specified', () => {
    const issue = createExecutionIssue({
      kind: 'watchdog',
      message: 'Fatal stall',
      nextAction: null,
      stopReason: 'stalled_no_edit_rounds',
      recoverable: false,
    });
    expect(issue.recoverable).toBe(false);
    expect(issue.nextAction).toBeNull();
  });

  it('creates a max_tool_rounds issue', () => {
    const issue = createExecutionIssue({
      kind: 'max_tool_rounds',
      message: 'Exceeded 25 rounds',
      nextAction: 'Complete or edit',
      stopReason: 'max_tool_rounds',
    });
    expect(issue.kind).toBe('max_tool_rounds');
    expect(issue.stopReason).toBe('max_tool_rounds');
  });
});

describe('deterministic no-progress blockers', () => {
  it('builds specific guidance for identical edit attempts', () => {
    expect(
      buildDeterministicBlockerGuidance(
        'edit_file: old_string and new_string are identical',
      ),
    ).toContain('no-op');
  });

  it('recognizes repeated identical edit attempts as deterministic blockers', () => {
    expect(
      isDeterministicNoProgressBlocker(
        'edit_file: old_string and new_string are identical',
      ),
    ).toBe(true);
  });

  it('fast-tracks stall handling after repeated deterministic blockers', () => {
    expect(
      shouldFastTrackNoEditStall({
        noEditToolRounds: 2,
        lastBlockingReason:
          'edit_file: old_string and new_string are identical',
      }),
    ).toBe(true);
  });

  it('does not fast-track generic blockers on the first no-edit round', () => {
    expect(
      shouldFastTrackNoEditStall({
        noEditToolRounds: 1,
        lastBlockingReason: 'bash: command failed',
      }),
    ).toBe(false);
  });

  it('uses blocker-specific nudge guidance when an identical edit repeats', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 0,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 0,
      discoveryCallsBeforeFirstEdit: 0,
      discoveryCallLimit: null,
      stepDescription: 'Update comments schema',
      lastBlockingReason: 'edit_file: old_string and new_string are identical',
    });

    expect(action.kind).toBe('nudge');
    if (action.kind === 'nudge') {
      expect(action.nudgeMessage).toContain('no-op');
      expect(action.nudgeMessage).toContain('NO_EDIT_JUSTIFIED');
    }
  });

  it('nudges for deterministic edit blockers even after earlier successful edits', () => {
    const action = decideNoEditProgressAction({
      noEditToolRounds: 8,
      maxNoEditToolRounds: 8,
      forcedEditNudges: 0,
      maxForcedEditNudges: 1,
      editsInCurrentExecuteStep: 4,
      discoveryCallsBeforeFirstEdit: 0,
      discoveryCallLimit: null,
      stepDescription: 'Update auth middleware and tests',
      lastBlockingReason:
        'edit_file: old_string matched 2 times. Provide more surrounding context to make it unique.',
    });

    expect(action.kind).toBe('nudge');
    if (action.kind === 'nudge') {
      expect(action.nudgeMessage).toContain('matched multiple places');
      expect(action.nudgeMessage).toContain('unique');
    }
  });

  it('treats bare STEP_COMPLETE with no edits as no-progress', () => {
    expect(
      shouldTreatCompletionAsNoEdit({
        completionSignaled: true,
        assistantText: 'STEP_COMPLETE',
        editsInCurrentExecuteStep: 0,
      }),
    ).toBe(true);
  });

  it('allows justified no-op completion without edits', () => {
    expect(
      shouldTreatCompletionAsNoEdit({
        completionSignaled: true,
        assistantText: 'NO_EDIT_JUSTIFIED: target missing\nSTEP_COMPLETE',
        editsInCurrentExecuteStep: 0,
      }),
    ).toBe(false);
  });

  it('accepts evidence-rich no-edit completion without the literal marker', () => {
    const text =
      'No edits needed for the explicit target files: shared/src/constants.ts already defines the shared HTTP status, error codes, and session timeout constants. STEP_COMPLETE';
    expect(hasNoEditJustification(text)).toBe(true);
    expect(
      shouldTreatCompletionAsNoEdit({
        completionSignaled: true,
        assistantText: text,
        editsInCurrentExecuteStep: 0,
      }),
    ).toBe(false);
  });

  it('accepts past-tense no-edit evidence phrasing', () => {
    const text =
      'Reviewed and preserved the shared auth-contract surface. No edits were needed in this step because shared/src/constants.ts already defines the required values. STEP_COMPLETE';
    expect(hasNoEditJustification(text)).toBe(true);
  });

  it('accepts domain-qualified no-edit evidence phrasing', () => {
    const text =
      'Reviewed api/src/db/schema.sql for the auth/session requirements. No schema edits were needed because the sessions, api_tokens, and audit_logs tables already define the required fields. STEP_COMPLETE';
    expect(hasNoEditJustification(text)).toBe(true);
  });

  it('still rejects bare no-op claims without evidence', () => {
    const text = 'No edits needed. STEP_COMPLETE';
    expect(hasNoEditJustification(text)).toBe(false);
    expect(
      shouldTreatCompletionAsNoEdit({
        completionSignaled: true,
        assistantText: text,
        editsInCurrentExecuteStep: 0,
      }),
    ).toBe(true);
  });

  it('allows completion after successful edits', () => {
    expect(
      shouldTreatCompletionAsNoEdit({
        completionSignaled: true,
        assistantText: 'STEP_COMPLETE',
        editsInCurrentExecuteStep: 2,
      }),
    ).toBe(false);
  });

  it('counts preserved edits from earlier execute retries in the same step', () => {
    expect(
      resolveEditsInCurrentExecuteStep({
        totalFileEdits: 5,
        currentStepEditBaseline: 3,
      }),
    ).toBe(2);
  });

  it('treats missing step baseline as no edits for this execute attempt', () => {
    expect(
      resolveEditsInCurrentExecuteStep({
        totalFileEdits: 5,
        currentStepEditBaseline: null,
      }),
    ).toBe(0);
  });

  it('fast-tracks repeated premature STEP_COMPLETE responses', () => {
    expect(
      shouldFastTrackNoEditStall({
        noEditToolRounds: 2,
        lastBlockingReason:
          'STEP_COMPLETE without any successful edit or NO_EDIT_JUSTIFIED evidence',
      }),
    ).toBe(true);
  });
});

describe('detectRepeatedToolCallLoop', () => {
  it('returns a watchdog message after three identical tool calls', () => {
    const message = detectRepeatedToolCallLoop([
      { tool_name: 'read_file', tool_input: { file_path: '/tmp/a.ts' }, tool_result: '{}', timestamp: 1, duration_ms: 1 },
      { tool_name: 'read_file', tool_input: { file_path: '/tmp/a.ts' }, tool_result: '{}', timestamp: 2, duration_ms: 1 },
      { tool_name: 'read_file', tool_input: { file_path: '/tmp/a.ts' }, tool_result: '{}', timestamp: 3, duration_ms: 1 },
    ]);

    expect(message).toContain('repeated identical tool call loop');
    expect(message).toContain('read_file ×3');
    expect(message).toContain('/tmp/a.ts');
  });

  it('ignores different arguments or tool names', () => {
    expect(detectRepeatedToolCallLoop([
      { tool_name: 'read_file', tool_input: { file_path: '/tmp/a.ts' }, tool_result: '{}', timestamp: 1, duration_ms: 1 },
      { tool_name: 'read_file', tool_input: { file_path: '/tmp/b.ts' }, tool_result: '{}', timestamp: 2, duration_ms: 1 },
      { tool_name: 'grep', tool_input: { pattern: 'x' }, tool_result: '{}', timestamp: 3, duration_ms: 1 },
    ])).toBeNull();
  });
});

describe('capToolHistory', () => {
  it('exports MAX_TOOL_HISTORY as 500', () => {
    expect(MAX_TOOL_HISTORY).toBe(500);
  });

  it('returns input unchanged when under cap', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = capToolHistory(history);
    expect(result).toEqual(history);
    expect(result).toBe(history); // same reference (no copy)
  });

  it('returns input unchanged when exactly at cap', () => {
    const history = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const result = capToolHistory(history);
    expect(result).toBe(history);
  });

  it('trims to most recent 500 when over cap', () => {
    const history = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const result = capToolHistory(history);
    expect(result).toHaveLength(500);
    // Should keep entries 100-599 (most recent 500)
    expect(result[0]).toEqual({ id: 100 });
    expect(result[499]).toEqual({ id: 599 });
  });

  it('works with empty array', () => {
    expect(capToolHistory([])).toEqual([]);
  });
});

describe('deriveBlockerCode', () => {
  it('returns ambiguous_edit for multiple match errors', () => {
    expect(deriveBlockerCode('edit_file: old_string matched 3 times. Provide more surrounding context to make it unique.')).toBe('ambiguous_edit');
  });

  it('returns identical_noop for identical old/new string', () => {
    expect(deriveBlockerCode('edit_file: old_string and new_string are identical')).toBe('identical_noop');
  });

  it('returns dir_as_file for directory edit attempt', () => {
    expect(deriveBlockerCode('edit_file: Cannot edit directory as file: /repo/src')).toBe('dir_as_file');
  });

  it('returns repeated_tool_loop for repeated calls', () => {
    expect(deriveBlockerCode('repeated identical tool call loop detected')).toBe('repeated_tool_loop');
  });

  it('returns deadline_exceeded for deadline errors', () => {
    expect(deriveBlockerCode('Watchdog: first edit deadline exceeded (130000ms > 120000ms).')).toBe('deadline_exceeded');
  });

  it('returns auth_error for unauthorized', () => {
    expect(deriveBlockerCode('Unauthorized access')).toBe('auth_error');
  });

  it('returns provider_error for unsupported model', () => {
    expect(deriveBlockerCode('not a chat model')).toBe('provider_error');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(deriveBlockerCode('some random error')).toBe('unknown');
  });

  it('returns unknown for null/empty', () => {
    expect(deriveBlockerCode(null)).toBe('unknown');
    expect(deriveBlockerCode('')).toBe('unknown');
  });
});

describe('buildAmbiguousEditRecoveryNudge', () => {
  it('returns null when file content is null', () => {
    expect(buildAmbiguousEditRecoveryNudge('/repo/a.ts', 'foo', null)).toBeNull();
  });

  it('returns null when old_string matches only once', () => {
    const content = 'line1\nfoo\nline3';
    expect(buildAmbiguousEditRecoveryNudge('/repo/a.ts', 'foo', content)).toBeNull();
  });

  it('returns enhanced nudge with match locations for multiple matches', () => {
    const content = 'line1\nfoo bar\nline3\nline4\nfoo bar\nline6';
    const result = buildAmbiguousEditRecoveryNudge('/repo/a.ts', 'foo bar', content);
    expect(result).not.toBeNull();
    expect(result).toContain('matched 2 places');
    expect(result).toContain('/repo/a.ts');
    expect(result).toContain('Match 1');
    expect(result).toContain('Match 2');
    expect(result).toContain('line 2');
    expect(result).toContain('line 5');
  });

  it('returns null when oldString is empty', () => {
    expect(buildAmbiguousEditRecoveryNudge('/repo/a.ts', '', 'some content')).toBeNull();
  });
});

describe('createExecutionIssue with blockerCode', () => {
  it('includes blockerCode when provided', () => {
    const issue = createExecutionIssue({
      kind: 'watchdog',
      message: 'stalled',
      nextAction: null,
      stopReason: 'stalled_no_edit_rounds',
      blockerCode: 'ambiguous_edit',
    });
    expect(issue.blockerCode).toBe('ambiguous_edit');
  });

  it('omits blockerCode when not provided', () => {
    const issue = createExecutionIssue({
      kind: 'watchdog',
      message: 'stalled',
      nextAction: null,
      stopReason: 'stalled_no_edit_rounds',
    });
    expect(issue.blockerCode).toBeUndefined();
  });
});
