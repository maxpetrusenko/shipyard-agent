// Re-export from state for backward compatibility
export type { ExecuteStopReason } from '../state.js';
import type { ExecuteStopReason } from '../state.js';

export interface ExecuteProgressDiagnostics {
  noEditToolRounds: number;
  discoveryCallsBeforeFirstEdit: number;
  lastBlockingReason: string | null;
  stopReason: ExecuteStopReason | null;
}

export type NoEditProgressAction =
  | { kind: 'continue'; diagnostics: ExecuteProgressDiagnostics }
  | {
      kind: 'nudge';
      diagnostics: ExecuteProgressDiagnostics;
      nudgeMessage: string;
    }
  | {
      kind: 'validated_noop';
      diagnostics: ExecuteProgressDiagnostics;
      reason: string;
    }
  | {
      kind: 'stall';
      diagnostics: ExecuteProgressDiagnostics;
      nextAction: string;
    };

export interface DecideNoEditProgressActionParams {
  noEditToolRounds: number;
  maxNoEditToolRounds: number;
  forcedEditNudges: number;
  maxForcedEditNudges: number;
  editsInCurrentExecuteStep: number;
  discoveryCallsBeforeFirstEdit: number;
  discoveryCallLimit: number | null;
  stepDescription: string;
  lastBlockingReason: string | null;
}

function forcedEditNudge(
  discoveryCallsBeforeFirstEdit: number,
  discoveryCallLimit: number | null,
): string {
  const limitMsg =
    discoveryCallLimit != null
      ? `${discoveryCallsBeforeFirstEdit}/${discoveryCallLimit}`
      : `${discoveryCallsBeforeFirstEdit}`;
  return (
    `You are stuck in discovery with no successful edits in this step.\n` +
    `Discovery calls before first edit: ${limitMsg}.\n` +
    `Take exactly one of these actions now:\n` +
    `1) Pick ONE concrete target file and call edit_file with a minimal patch.\n` +
    `2) If the step is conditional and target is absent, respond:\n` +
    `   NO_EDIT_JUSTIFIED: <one-sentence evidence>\n` +
    `   STEP_COMPLETE\n` +
    `Do not run more broad discovery before one of those actions.`
  );
}

function isConditionalStepDescription(stepDescription: string): boolean {
  const text = stepDescription.trim().toLowerCase();
  if (!text) return false;
  if (text.startsWith('if ')) return true;
  return (
    /\bif\b/.test(text) &&
    /\b(exists?|present|found|available|missing|does not exist|not found)\b/.test(
      text,
    )
  );
}

function diagnosticsFrom(
  params: Omit<DecideNoEditProgressActionParams, 'stepDescription'> & {
    stopReason: ExecuteProgressDiagnostics['stopReason'];
  },
): ExecuteProgressDiagnostics {
  return {
    noEditToolRounds: params.noEditToolRounds,
    discoveryCallsBeforeFirstEdit: params.discoveryCallsBeforeFirstEdit,
    lastBlockingReason: params.lastBlockingReason,
    stopReason: params.stopReason,
  };
}

export function decideNoEditProgressAction(
  params: DecideNoEditProgressActionParams,
): NoEditProgressAction {
  if (params.noEditToolRounds < params.maxNoEditToolRounds) {
    return {
      kind: 'continue',
      diagnostics: diagnosticsFrom({ ...params, stopReason: null }),
    };
  }

  if (
    params.editsInCurrentExecuteStep === 0 &&
    params.forcedEditNudges < params.maxForcedEditNudges
  ) {
    return {
      kind: 'nudge',
      diagnostics: diagnosticsFrom({ ...params, stopReason: null }),
      nudgeMessage: forcedEditNudge(
        params.discoveryCallsBeforeFirstEdit,
        params.discoveryCallLimit,
      ),
    };
  }

  const conditionalStep = isConditionalStepDescription(params.stepDescription);
  if (
    params.editsInCurrentExecuteStep === 0 &&
    conditionalStep &&
    params.discoveryCallsBeforeFirstEdit > 0 &&
    !params.lastBlockingReason
  ) {
    return {
      kind: 'validated_noop',
      diagnostics: diagnosticsFrom({ ...params, stopReason: 'validated_noop' }),
      reason:
        'Validated conditional no-op after discovery: step precondition was not met, so no edit was applied.',
    };
  }

  const nextAction = params.lastBlockingReason
    ? `Resolve the blocker, then run one concrete edit_file call. Blocker: ${params.lastBlockingReason}`
    : 'Perform one concrete edit_file call against a target file, or return NO_EDIT_JUSTIFIED with evidence.';
  return {
    kind: 'stall',
    diagnostics: diagnosticsFrom({
      ...params,
      stopReason: 'stalled_no_edit_rounds',
    }),
    nextAction,
  };
}

export function isDeterministicNoProgressBlocker(
  lastBlockingReason: string | null,
): boolean {
  const text = lastBlockingReason?.toLowerCase() ?? '';
  if (!text) return false;
  return (
    text.includes('old_string and new_string are identical') ||
    text.includes('cannot edit directory as file') ||
    text.includes('cannot read directory as file') ||
    text.includes('old_string cannot be empty') ||
    text.includes('matched') && text.includes('provide more surrounding context')
  );
}

export function shouldFastTrackNoEditStall(params: {
  noEditToolRounds: number;
  lastBlockingReason: string | null;
}): boolean {
  return (
    params.noEditToolRounds >= 2 &&
    isDeterministicNoProgressBlocker(params.lastBlockingReason)
  );
}

export function formatExecuteWatchdogError(
  diagnostics: ExecuteProgressDiagnostics,
  nextAction: string,
): string {
  return (
    `Watchdog: execution stalled after ${diagnostics.noEditToolRounds} consecutive no-edit tool rounds. ` +
    `Next action: ${nextAction}. ` +
    `Execute diagnostics: ${JSON.stringify(diagnostics)}`
  );
}

export function parseExecuteDiagnosticsFromError(
  message: string,
): ExecuteProgressDiagnostics | null {
  const m = message.match(/Execute diagnostics:\s*(\{[\s\S]*\})/);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(m[1]) as ExecuteProgressDiagnostics;
    if (
      typeof parsed.noEditToolRounds === 'number' &&
      typeof parsed.discoveryCallsBeforeFirstEdit === 'number' &&
      'lastBlockingReason' in parsed &&
      'stopReason' in parsed
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

import type { ExecutionIssue } from '../state.js';

export function createExecutionIssue(params: {
  kind: ExecutionIssue['kind'];
  message: string;
  nextAction: string | null;
  stopReason: ExecuteStopReason | null;
  recoverable?: boolean;
}): ExecutionIssue {
  return {
    kind: params.kind,
    recoverable: params.recoverable ?? true,
    message: params.message,
    nextAction: params.nextAction,
    stopReason: params.stopReason,
  };
}

export function deriveBlockingReasonFromToolResult(
  toolName: string,
  result: Record<string, unknown>,
): string | null {
  const success = result['success'];
  if (success === true) return null;
  const message = result['message'];
  if (typeof message === 'string' && message.trim().length > 0) {
    return `${toolName}: ${message.trim()}`;
  }
  return `${toolName}: tool call returned success=false`;
}
