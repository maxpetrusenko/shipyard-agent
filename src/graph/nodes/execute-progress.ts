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
  stepFiles?: string[];
  assistantText?: string;
  readBackedSatisfied?: boolean;
  lastBlockingReason: string | null;
  /** File path of the last failing edit_file call (for ambiguous-edit recovery). */
  lastFailingEditFilePath?: string | null;
  /** old_string of the last failing edit_file call (for ambiguous-edit recovery). */
  lastFailingEditOldString?: string | null;
  /** File content of the last failing edit target (for ambiguous-edit recovery). */
  lastFailingEditFileContent?: string | null;
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

export function buildDeterministicBlockerGuidance(
  lastBlockingReason: string | null,
): string | null {
  const text = lastBlockingReason?.trim() ?? '';
  const lower = text.toLowerCase();
  if (!lower) return null;
  if (lower.includes('old_string and new_string are identical')) {
    return (
      'Your last edit_file call was a no-op because old_string and new_string were identical.\n' +
      'Re-read the target file and choose a replacement that actually changes the file.\n' +
      'If the desired text already exists, respond with NO_EDIT_JUSTIFIED and STEP_COMPLETE instead of repeating the same edit.'
    );
  }
  if (lower.includes('provide more surrounding context')) {
    return (
      'Your last edit_file call failed because old_string matched multiple places.\n' +
      'Re-read the file and include more surrounding context so the replacement is unique.\n' +
      'Do not retry the same old_string again.'
    );
  }
  if (
    lower.includes('cannot edit directory as file') ||
    lower.includes('cannot read directory as file')
  ) {
    return (
      'Your last tool call targeted a directory, not a file.\n' +
      'List the directory contents, pick one concrete file inside the allowed scope, then edit that file.'
    );
  }
  if (lower.includes('old_string cannot be empty')) {
    return (
      'Your last edit_file call had an empty old_string.\n' +
      'Read the file and choose a concrete existing snippet to replace.'
    );
  }
  if (lower.includes('step_complete without any successful edit')) {
    return (
      'You declared STEP_COMPLETE without making a successful edit for this step.\n' +
      'Re-read the current step file list and make one concrete edit_file or write_file call now.\n' +
      'If the step is truly a no-op, respond with NO_EDIT_JUSTIFIED and one-sentence evidence before STEP_COMPLETE.'
    );
  }
  return null;
}

function isConditionalStepDescription(stepDescription: string): boolean {
  const text = stepDescription.trim().toLowerCase();
  if (!text) return false;
  if (text.startsWith('if ')) return true;
  if (/\bonly as needed\b|\bif needed\b/.test(text)) return true;
  if (
    /\bas needed\b/.test(text) &&
    /\b(without breaking|preserv(?:e|es|ing)|existing|compatib(?:le|ility)|callers?|unchanged)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(confirm|review|preserve|preserving)\b/.test(text) &&
    /\b(existing|already|unchanged|source of truth|re-export|re-exports|export shape)\b/.test(text)
  ) {
    return true;
  }
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

function basename(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts.at(-1) ?? filePath;
}

function hasNarratedImplementationEvidence(
  assistantText: string | undefined,
  stepFiles: string[] | undefined,
): boolean {
  const text = assistantText?.trim() ?? '';
  if (text.length < 120) return false;
  if (!/(implement(?:ed)?|updat(?:e|ed)|harden(?:ed)?|align(?:ed)?|refin(?:e|ed)|add(?:ed)?|complete(?:d)?|secure(?:d)?)/i.test(text)) {
    return false;
  }
  const files = stepFiles ?? [];
  if (files.length === 0 || files.length > 2) return false;
  const lower = text.toLowerCase();
  const mentionsScopedFile = files.some((filePath) => {
    const full = filePath.toLowerCase();
    const base = basename(filePath).toLowerCase();
    return lower.includes(full) || lower.includes(base);
  });
  if (!mentionsScopedFile) return false;
  const bulletCount = (text.match(/(?:^|\n)-\s/g) ?? []).length;
  return bulletCount >= 2 || text.length >= 220;
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

  const deterministicGuidance = buildDeterministicBlockerGuidance(
    params.lastBlockingReason,
  );

  if (deterministicGuidance && params.forcedEditNudges < params.maxForcedEditNudges) {
    // For ambiguous edits, try the rich nudge with match locations first
    let nudgeMessage = deterministicGuidance;
    if (
      params.lastFailingEditFilePath &&
      params.lastFailingEditOldString &&
      params.lastFailingEditFileContent &&
      deriveBlockerCode(params.lastBlockingReason) === 'ambiguous_edit'
    ) {
      const richNudge = buildAmbiguousEditRecoveryNudge(
        params.lastFailingEditFilePath,
        params.lastFailingEditOldString,
        params.lastFailingEditFileContent,
      );
      if (richNudge) nudgeMessage = richNudge;
    }
    return {
      kind: 'nudge',
      diagnostics: diagnosticsFrom({ ...params, stopReason: null }),
      nudgeMessage,
    };
  }

  if (
    params.editsInCurrentExecuteStep === 0 &&
    params.forcedEditNudges < params.maxForcedEditNudges
  ) {
    return {
      kind: 'nudge',
      diagnostics: diagnosticsFrom({ ...params, stopReason: null }),
      nudgeMessage:
        deterministicGuidance ??
        forcedEditNudge(
          params.discoveryCallsBeforeFirstEdit,
          params.discoveryCallLimit,
        ),
    };
  }

  const conditionalStep = isConditionalStepDescription(params.stepDescription);
  const prematureCompletionOnly =
    params.lastBlockingReason?.toLowerCase().includes(
      'step_complete without any successful edit',
    ) ?? false;
  const identicalNoOpEdit =
    params.lastBlockingReason?.toLowerCase().includes(
      'old_string and new_string are identical',
    ) ?? false;
  if (
    params.editsInCurrentExecuteStep === 0 &&
    conditionalStep &&
    params.discoveryCallsBeforeFirstEdit > 0 &&
    (!params.lastBlockingReason || prematureCompletionOnly)
  ) {
    return {
      kind: 'validated_noop',
      diagnostics: diagnosticsFrom({ ...params, stopReason: 'validated_noop' }),
      reason:
        'Validated conditional no-op after discovery: step precondition was not met, so no edit was applied.',
    };
  }

  if (
    params.editsInCurrentExecuteStep === 0 &&
    prematureCompletionOnly &&
    params.readBackedSatisfied === true
  ) {
    return {
      kind: 'validated_noop',
      diagnostics: diagnosticsFrom({ ...params, stopReason: 'validated_noop' }),
      reason:
        'Validated no-op from read-backed evidence: the scoped file content already covers the requested step requirements.',
    };
  }

  if (
    params.editsInCurrentExecuteStep === 0 &&
    identicalNoOpEdit &&
    params.readBackedSatisfied === true
  ) {
    return {
      kind: 'validated_noop',
      diagnostics: diagnosticsFrom({ ...params, stopReason: 'validated_noop' }),
      reason:
        'Validated no-op after repeated identical edit attempts: scoped file reads already cover the requested implementation, so the failed edit was a redundant no-op.',
    };
  }

  if (
    params.editsInCurrentExecuteStep === 0 &&
    identicalNoOpEdit &&
    hasNarratedImplementationEvidence(params.assistantText, params.stepFiles)
  ) {
    return {
      kind: 'validated_noop',
      diagnostics: diagnosticsFrom({ ...params, stopReason: 'validated_noop' }),
      reason:
        'Validated no-op after repeated identical edit attempts: the scoped file was re-read and described as already satisfying the requested implementation.',
    };
  }

  const nextAction = deterministicGuidance
    ? deterministicGuidance.replace(/\n/g, ' ')
    : params.lastBlockingReason
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
    text.includes('step_complete without any successful edit') ||
    text.includes('matched') && text.includes('provide more surrounding context')
  );
}

export function shouldTreatCompletionAsNoEdit(params: {
  completionSignaled: boolean;
  assistantText: string;
  editsInCurrentExecuteStep: number;
}): boolean {
  if (!params.completionSignaled) return false;
  if (params.editsInCurrentExecuteStep > 0) return false;
  return !hasNoEditJustification(params.assistantText);
}

export function hasNoEditJustification(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text) return false;
  if (text.includes('NO_EDIT_JUSTIFIED')) return true;
  if (!/(already|exists|unrelated|no change|no changes|no edits|not required|not needed)/i.test(text)) {
    return false;
  }
  if (!/(no(?:\s+\w+){0,4}\s+edits?\s+(?:needed|were needed|required|were required)|no(?:\s+\w+){0,4}\s+changes?\s+(?:needed|were needed|required|were required)|no update required|no updates required|already (?:defines|implements|exists|exposes|imports)|did not require)/i.test(text)) {
    return false;
  }
  return text.length >= 40;
}

export function resolveEditsInCurrentExecuteStep(params: {
  totalFileEdits: number;
  currentStepEditBaseline: number | null | undefined;
}): number {
  const baseline =
    typeof params.currentStepEditBaseline === 'number'
      ? params.currentStepEditBaseline
      : params.totalFileEdits;
  return Math.max(0, params.totalFileEdits - baseline);
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
  const m = message.match(/Execute diagnostics:\s*(\{[\s\S]*?\})/);
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

import type { ExecutionIssue, WatchdogBlockerCode } from '../state.js';

/**
 * Derive a structured blocker code from the raw blocking reason text.
 * This enables programmatic recovery routing instead of text matching.
 */
export function deriveBlockerCode(lastBlockingReason: string | null): WatchdogBlockerCode {
  const text = lastBlockingReason?.toLowerCase() ?? '';
  if (!text) return 'unknown';
  if (text.includes('provide more surrounding context') || (text.includes('matched') && text.includes('times'))) return 'ambiguous_edit';
  if (text.includes('old_string and new_string are identical')) return 'identical_noop';
  if (text.includes('cannot edit directory as file') || text.includes('cannot read directory as file')) return 'dir_as_file';
  if (text.includes('old_string cannot be empty')) return 'empty_old';
  if (text.includes('step_complete without any successful edit')) return 'premature_complete';
  if (text.includes('repeated identical tool call loop')) return 'repeated_tool_loop';
  if (text.includes('first edit deadline exceeded') || text.includes('discovery tool calls before first edit exceeded')) return 'deadline_exceeded';
  if (text.includes('unauthorized') || text.includes('forbidden')) return 'auth_error';
  if (text.includes('not a chat model') || text.includes('not supported in v1/chat/completions')) return 'provider_error';
  return 'unknown';
}

/**
 * Build an enhanced nudge for ambiguous edits that includes match locations.
 * Reads file content and shows WHERE each match occurs with line numbers.
 */
export function buildAmbiguousEditRecoveryNudge(
  filePath: string,
  oldString: string,
  fileContent: string | null,
): string | null {
  if (!fileContent || !oldString) return null;

  const lines = fileContent.split('\n');
  const matchLocations: { lineStart: number; preview: string }[] = [];
  const searchStr = oldString;
  let searchPos = 0;

  while (searchPos < fileContent.length) {
    const idx = fileContent.indexOf(searchStr, searchPos);
    if (idx === -1) break;

    // Find line number of this match
    const lineNum = fileContent.slice(0, idx).split('\n').length;
    const contextStart = Math.max(0, lineNum - 2);
    const contextEnd = Math.min(lines.length, lineNum + oldString.split('\n').length + 1);
    const preview = lines
      .slice(contextStart, contextEnd)
      .map((l, i) => `  ${contextStart + i + 1}: ${l}`)
      .join('\n');
    matchLocations.push({ lineStart: lineNum, preview });
    searchPos = idx + 1;
  }

  if (matchLocations.length < 2) return null;

  return (
    `Your edit_file call failed because old_string matched ${matchLocations.length} places in ${filePath}.\n` +
    `Here are the exact locations:\n\n` +
    matchLocations.map((loc, i) =>
      `Match ${i + 1} at line ${loc.lineStart}:\n${loc.preview}`
    ).join('\n\n') +
    `\n\nTo fix: include more lines BEFORE or AFTER your old_string to make it unique to ONE of these locations.\n` +
    `Pick the specific match you want to edit and expand old_string with its unique surrounding context.`
  );
}

export function createExecutionIssue(params: {
  kind: ExecutionIssue['kind'];
  message: string;
  nextAction: string | null;
  stopReason: ExecuteStopReason | null;
  recoverable?: boolean;
  blockerCode?: WatchdogBlockerCode;
}): ExecutionIssue {
  return {
    kind: params.kind,
    recoverable: params.recoverable ?? true,
    message: params.message,
    nextAction: params.nextAction,
    stopReason: params.stopReason,
    blockerCode: params.blockerCode,
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
