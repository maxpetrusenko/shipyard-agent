import { describe, it, expect } from 'vitest';
import {
  appendNextActionsToAssistantMessage,
  deriveNextActions,
} from '../../src/runtime/next-actions.js';
import type { RunResult } from '../../src/runtime/loop.js';

function baseRun(): RunResult {
  return {
    runId: 'run-1',
    phase: 'done',
    steps: [],
    fileEdits: [],
    toolCallHistory: [],
    tokenUsage: null,
    traceUrl: null,
    messages: [{ role: 'user', content: 'refactor auth' }],
    error: null,
    verificationResult: { passed: true, error_count: 0 },
    reviewFeedback: null,
    durationMs: 1000,
    threadKind: 'agent',
    runMode: 'code',
    executionPath: 'graph',
  };
}

describe('deriveNextActions', () => {
  it('suggests opening a PR after successful code changes', () => {
    const run = baseRun();
    run.fileEdits = [
      {
        file_path: '/tmp/a.ts',
        tier: 1,
        old_string: 'a',
        new_string: 'b',
        timestamp: Date.now(),
      },
    ];

    const actions = deriveNextActions(run);
    expect(actions.some((a) => a.id === 'open_pr' && a.recommended)).toBe(true);
  });

  it('does not suggest opening PR when a successful PR tool call already exists', () => {
    const run = baseRun();
    run.fileEdits = [
      {
        file_path: '/tmp/a.ts',
        tier: 1,
        old_string: 'a',
        new_string: 'b',
        timestamp: Date.now(),
      },
    ];
    run.toolCallHistory = [
      {
        tool_name: 'commit_and_open_pr',
        tool_input: {},
        tool_result: JSON.stringify({
          success: true,
          pr_url: 'https://github.com/o/r/pull/10',
        }),
        timestamp: Date.now(),
        duration_ms: 5,
      },
    ];

    const actions = deriveNextActions(run);
    expect(actions.some((a) => a.id === 'open_pr')).toBe(false);
  });

  it('suggests failure recovery actions when run fails', () => {
    const run = baseRun();
    run.phase = 'error';
    run.error = 'typecheck failed';

    const actions = deriveNextActions(run);
    expect(actions[0]?.id).toBe('inspect_failure');
    expect(actions.some((a) => a.id === 'retry_with_feedback')).toBe(true);
  });

  it('suggests plan confirmation actions when awaiting confirmation', () => {
    const run = baseRun();
    run.phase = 'awaiting_confirmation';

    const actions = deriveNextActions(run);
    expect(actions.some((a) => a.id === 'confirm_plan')).toBe(true);
    expect(actions.some((a) => a.id === 'edit_plan')).toBe(true);
  });
});

describe('appendNextActionsToAssistantMessage', () => {
  it('appends suggested steps to latest assistant message', () => {
    const out = appendNextActionsToAssistantMessage(
      [
        { role: 'user', content: 'do x' },
        { role: 'assistant', content: 'Done' },
      ],
      [
        {
          id: 'open_pr',
          label: 'Open PR',
          description: 'Create pull request',
          recommended: true,
          prompt: 'Open a PR now.',
        },
      ],
    );
    expect(out[1]?.content).toContain('## Suggested Next Steps');
    expect(out[1]?.content).toContain('Open PR');
  });
});
