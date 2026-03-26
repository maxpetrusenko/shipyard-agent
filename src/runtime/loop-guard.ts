import type {
  LoopDiagnostics,
  ShipyardStateType,
  ToolCallRecord,
} from '../graph/state.js';

const DEFAULT_RECURSION_LIMIT = 80;
const DEFAULT_SOFT_BUDGET = 56;
const MIN_RECURSION_LIMIT = 32;
const MAX_RECURSION_LIMIT = 400;
const MIN_SOFT_BUDGET = 12;
const MAX_IDENTICAL_TRANSITIONS_WITHOUT_PROGRESS = 4;
const MAX_NO_PROGRESS_STREAK = 9;
const MAX_REVIEW_VERIFY_REPEAT_STREAK = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parsePositiveIntEnv(
  key: string,
  fallback: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveGraphRecursionLimit(): number {
  const configured = parsePositiveIntEnv(
    'SHIPYARD_GRAPH_RECURSION_LIMIT',
    DEFAULT_RECURSION_LIMIT,
  );
  return clamp(configured, MIN_RECURSION_LIMIT, MAX_RECURSION_LIMIT);
}

export function resolveGraphSoftBudget(recursionLimit: number): number {
  const fallback = Math.min(
    recursionLimit - 1,
    DEFAULT_SOFT_BUDGET,
  );
  const configured = parsePositiveIntEnv(
    'SHIPYARD_GRAPH_SOFT_BUDGET',
    fallback,
  );
  return clamp(configured, MIN_SOFT_BUDGET, recursionLimit - 1);
}

function countSuccessfulToolOutcomes(
  history: ToolCallRecord[],
): number {
  let count = 0;
  for (const call of history) {
    const raw = call.tool_result;
    if (!raw) continue;
    if (/"success"\s*:\s*true/i.test(raw)) {
      count += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { success?: unknown };
      if (parsed.success === true) count += 1;
    } catch {
      // Ignore non-JSON tool outputs.
    }
  }
  return count;
}

function doneStepCount(state: ShipyardStateType): number {
  return state.steps.filter((step) => step.status === 'done').length;
}

function verificationSignature(state: ShipyardStateType): string {
  const verification = state.verificationResult;
  if (!verification) return 'none';
  return `${verification.passed ? '1' : '0'}:${verification.error_count}`;
}

function progressSignature(
  state: ShipyardStateType,
  successfulToolOutcomes: number,
): string {
  return [
    state.currentStepIndex,
    doneStepCount(state),
    state.fileEdits.length,
    successfulToolOutcomes,
    verificationSignature(state),
    state.reviewDecision ?? 'none',
    state.retryCount,
  ].join('|');
}

function reviewVerifySignature(
  state: ShipyardStateType,
  successfulToolOutcomes: number,
): string {
  return [
    state.currentStepIndex,
    doneStepCount(state),
    verificationSignature(state),
    state.reviewDecision ?? 'none',
    state.fileEdits.length,
    successfulToolOutcomes,
  ].join('|');
}

function dynamicSoftBudget(
  state: ShipyardStateType,
  baseSoftBudget: number,
  recursionLimit: number,
): number {
  const expected =
    12 +
    state.steps.length * 4 +
    Math.max(0, state.maxRetries) * 3;
  return clamp(
    Math.max(baseSoftBudget, expected),
    MIN_SOFT_BUDGET,
    recursionLimit - 1,
  );
}

function formatTransition(
  fromPhase: ShipyardStateType['phase'],
  toPhase: ShipyardStateType['phase'],
): string {
  return `${fromPhase}->${toPhase}`;
}

interface LoopGuardTracker {
  diagnostics: LoopDiagnostics;
  lastProgressSignature: string | null;
  lastReviewVerifySignature: string | null;
  lastFileEditCount: number;
  lastSuccessfulToolOutcomes: number;
}

export function createInitialLoopDiagnostics(params: {
  recursionLimit: number;
  softBudget: number;
}): LoopDiagnostics {
  return {
    graphStepCount: 0,
    graphSoftBudget: params.softBudget,
    recursionLimit: params.recursionLimit,
    stopReason: null,
    noProgressReason: null,
    lastPhaseTransition: null,
    repeatedTransitionCount: 0,
    noProgressStreak: 0,
    repeatedReviewVerifyCount: 0,
    successfulToolOutcomes: 0,
  };
}

export function createLoopGuard(params: {
  recursionLimit: number;
  softBudget: number;
  initialState: ShipyardStateType;
  useDynamicSoftBudget?: boolean;
}): {
  observe: (
    prevState: ShipyardStateType,
    nextState: ShipyardStateType,
  ) => LoopDiagnostics;
  current: () => LoopDiagnostics;
} {
  const tracker: LoopGuardTracker = {
    diagnostics: createInitialLoopDiagnostics({
      recursionLimit: params.recursionLimit,
      softBudget: params.softBudget,
    }),
    lastProgressSignature: progressSignature(params.initialState, 0),
    lastReviewVerifySignature: reviewVerifySignature(params.initialState, 0),
    lastFileEditCount: params.initialState.fileEdits.length,
    lastSuccessfulToolOutcomes: 0,
  };

  const observe = (
    prevState: ShipyardStateType,
    nextState: ShipyardStateType,
  ): LoopDiagnostics => {
    const transition = formatTransition(prevState.phase, nextState.phase);
    const successfulToolOutcomes = countSuccessfulToolOutcomes(
      nextState.toolCallHistory,
    );
    const progressSig = progressSignature(nextState, successfulToolOutcomes);
    const reviewSig = reviewVerifySignature(nextState, successfulToolOutcomes);
    const nextSoftBudget = dynamicSoftBudget(
      nextState,
      params.softBudget,
      params.recursionLimit,
    );
    const effectiveSoftBudget =
      params.useDynamicSoftBudget === false
        ? params.softBudget
        : nextSoftBudget;
    const repeatedTransitionCount =
      tracker.diagnostics.lastPhaseTransition === transition
        ? tracker.diagnostics.repeatedTransitionCount + 1
        : 1;
    const noProgressStreak =
      tracker.lastProgressSignature === progressSig
        ? tracker.diagnostics.noProgressStreak + 1
        : 0;

    const reviewVerifyPhase =
      nextState.phase === 'verifying' ||
      nextState.phase === 'reviewing' ||
      transition === 'reviewing->planning' ||
      transition === 'planning->executing';
    const repeatedReviewVerifyCount =
      reviewVerifyPhase && tracker.lastReviewVerifySignature === reviewSig
        ? tracker.diagnostics.repeatedReviewVerifyCount + 1
        : reviewVerifyPhase
          ? 1
          : 0;

    const noNewFileEdits =
      nextState.fileEdits.length === tracker.lastFileEditCount;
    const noNewSuccessfulToolOutcomes =
      successfulToolOutcomes === tracker.lastSuccessfulToolOutcomes;

    let stopReason: LoopDiagnostics['stopReason'] =
      tracker.diagnostics.stopReason;
    let noProgressReason: string | null = null;
    const graphStepCount = tracker.diagnostics.graphStepCount + 1;

    if (graphStepCount >= effectiveSoftBudget) {
      stopReason = 'soft_budget_exceeded';
      noProgressReason =
        `Exceeded soft graph budget (${graphStepCount}/${effectiveSoftBudget}) before hard recursion limit (${params.recursionLimit}).`;
    } else if (
      repeatedTransitionCount >= MAX_IDENTICAL_TRANSITIONS_WITHOUT_PROGRESS &&
      noNewFileEdits &&
      noNewSuccessfulToolOutcomes
    ) {
      stopReason = 'no_progress';
      noProgressReason =
        `Repeated identical phase transition (${transition}) ${repeatedTransitionCount} times without new edits or successful tools.`;
    } else if (
      repeatedReviewVerifyCount >= MAX_REVIEW_VERIFY_REPEAT_STREAK &&
      noNewFileEdits &&
      noNewSuccessfulToolOutcomes
    ) {
      stopReason = 'no_progress';
      noProgressReason =
        `Repeated review/verify outcomes without state change (${repeatedReviewVerifyCount} repeats).`;
    } else if (
      noProgressStreak >= MAX_NO_PROGRESS_STREAK &&
      noNewFileEdits &&
      noNewSuccessfulToolOutcomes
    ) {
      stopReason = 'no_progress';
      noProgressReason =
        `No graph state progress for ${noProgressStreak} consecutive updates (step=${nextState.currentStepIndex}).`;
    }

    const diagnostics: LoopDiagnostics = {
      graphStepCount,
      graphSoftBudget: effectiveSoftBudget,
      recursionLimit: params.recursionLimit,
      stopReason,
      noProgressReason,
      lastPhaseTransition: transition,
      repeatedTransitionCount,
      noProgressStreak,
      repeatedReviewVerifyCount,
      successfulToolOutcomes,
    };

    tracker.diagnostics = diagnostics;
    tracker.lastProgressSignature = progressSig;
    tracker.lastReviewVerifySignature = reviewSig;
    tracker.lastFileEditCount = nextState.fileEdits.length;
    tracker.lastSuccessfulToolOutcomes = successfulToolOutcomes;

    return diagnostics;
  };

  const current = (): LoopDiagnostics => tracker.diagnostics;

  return { observe, current };
}

export function isGraphRecursionLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'GraphRecursionError') return true;
  return /recursion limit of \d+ reached/i.test(err.message);
}

export function withHardRecursionStop(
  diagnostics: LoopDiagnostics | null,
  recursionLimit: number,
): LoopDiagnostics {
  const base = diagnostics ?? createInitialLoopDiagnostics({
    recursionLimit,
    softBudget: resolveGraphSoftBudget(recursionLimit),
  });
  return {
    ...base,
    stopReason: 'hard_recursion_limit',
    recursionLimit,
    noProgressReason:
      base.noProgressReason ??
      `LangGraph hard recursion limit reached at ${recursionLimit}.`,
  };
}

export function formatLoopStopError(
  diagnostics: LoopDiagnostics,
): string {
  const prefix =
    diagnostics.stopReason === 'soft_budget_exceeded'
      ? 'Stopped on soft graph budget before hard recursion limit.'
      : diagnostics.stopReason === 'hard_recursion_limit'
        ? 'Graph recursion limit reached without a stop condition.'
        : 'Stopped due to no progress in graph execution.';
  const noProgress = diagnostics.noProgressReason
    ? ` no_progress_reason=${diagnostics.noProgressReason}`
    : '';
  return (
    `${prefix} ` +
    `step_count=${diagnostics.graphStepCount} ` +
    `soft_budget=${diagnostics.graphSoftBudget} ` +
    `recursion_limit=${diagnostics.recursionLimit} ` +
    `last_transition=${diagnostics.lastPhaseTransition ?? 'n/a'} ` +
    `stop_reason=${diagnostics.stopReason ?? 'unknown'}` +
    noProgress
  );
}
