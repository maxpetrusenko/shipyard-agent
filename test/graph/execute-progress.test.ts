import { describe, expect, it } from 'vitest';
import {
  createExecutionIssue,
  decideNoEditProgressAction,
  formatExecuteWatchdogError,
  isDeterministicNoProgressBlocker,
  parseExecuteDiagnosticsFromError,
  shouldFastTrackNoEditStall,
} from '../../src/graph/nodes/execute-progress.js';
import {
  capToolHistory,
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
