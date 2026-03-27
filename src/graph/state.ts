/**
 * Shipyard LangGraph state annotation.
 *
 * Tracks the full lifecycle of a coding instruction:
 * plan -> execute -> verify -> review -> done/retry/error
 */

import { Annotation } from '@langchain/langgraph';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export type ShipyardPhase =
  | 'idle'
  | 'routing'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'reviewing'
  | 'awaiting_confirmation'
  | 'paused'
  | 'done'
  | 'error';

export interface PlanStep {
  index: number;
  description: string;
  files: string[];
  status: 'pending' | 'in_progress' | 'done' | 'failed';
}

export interface FileEdit {
  file_path: string;
  tier: 1 | 2 | 3 | 4;
  old_string: string;
  new_string: string;
  timestamp: number;
}

export interface ToolCallRecord {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_result: string;
  timestamp: number;
  duration_ms: number;
}

export interface VerificationResult {
  passed: boolean;
  typecheck_output?: string;
  test_output?: string;
  error_count: number;
  /** Errors that existed before this run (baseline). */
  preExistingErrorCount?: number;
  /** Errors introduced by this run (error_count - preExistingErrorCount). */
  newErrorCount?: number;
  /** Hash of pre-run verification output for diffing. */
  baselineFingerprint?: string;
}

export type ReviewDecision = 'continue' | 'done' | 'retry' | 'escalate';

export type ExecuteStopReason =
  | 'step_complete'
  | 'validated_noop'
  | 'stalled_no_edit_rounds'
  | 'guardrail_violation'
  | 'max_tool_rounds';

export interface ExecutionIssue {
  kind: 'guardrail' | 'watchdog' | 'max_tool_rounds' | 'coordination';
  recoverable: boolean;
  message: string;
  nextAction: string | null;
  stopReason: ExecuteStopReason | null;
}

export interface LoopDiagnostics {
  graphStepCount: number;
  graphSoftBudget: number;
  recursionLimit: number;
  stopReason: string | null;
  noProgressReason: string | null;
  lastPhaseTransition: string | null;
  repeatedTransitionCount: number;
  noProgressStreak: number;
  repeatedReviewVerifyCount: number;
  successfulToolOutcomes: number;
}

export interface ExecuteDiagnostics {
  noEditToolRounds: number;
  discoveryCallsBeforeFirstEdit: number;
  lastBlockingReason: string | null;
  stopReason:
    | 'step_complete'
    | 'validated_noop'
    | 'stalled_no_edit_rounds'
    | 'guardrail_violation'
    | 'max_tool_rounds'
    | null;
}

export interface ContextEntry {
  label: string;
  content: string;
  source: 'user' | 'tool' | 'system';
}

/** Markdown-ish block for injected contexts (shared by plan/execute/worker). */
export function buildContextBlock(contexts: ContextEntry[]): string {
  return contexts.map((c) => `## ${c.label}\n${c.content}`).join('\n\n');
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ---------------------------------------------------------------------------
// State annotation
// ---------------------------------------------------------------------------

export const ShipyardState = Annotation.Root({
  // Identity
  runId: Annotation<string>,
  traceId: Annotation<string>,
  instruction: Annotation<string>,

  // Phase tracking
  phase: Annotation<ShipyardPhase>,

  // Plan decomposition
  steps: Annotation<PlanStep[]>,
  currentStepIndex: Annotation<number>,

  // Execution tracking
  fileEdits: Annotation<FileEdit[]>,
  toolCallHistory: Annotation<ToolCallRecord[]>,

  // Verification
  verificationResult: Annotation<VerificationResult | null>,

  // Review (Opus judgment)
  reviewDecision: Annotation<ReviewDecision | null>,
  reviewFeedback: Annotation<string | null>,

  // Context injection
  contexts: Annotation<ContextEntry[]>,

  // Conversation history
  messages: Annotation<LLMMessage[]>,

  // Error tracking
  error: Annotation<string | null>,
  retryCount: Annotation<number>,
  maxRetries: Annotation<number>,

  // Execution issue (soft recovery signal from execute → verify → review)
  executionIssue: Annotation<ExecutionIssue | null>,

  // Telemetry
  tokenUsage: Annotation<{
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreation?: number;
  } | null>,
  traceUrl: Annotation<string | null>,
  runStartedAt: Annotation<number>,

  // File overlay snapshots for rollback on retry (JSON-serialized Map<path, content>)
  fileOverlaySnapshots: Annotation<string | null>,

  // Cost tracking
  estimatedCost: Annotation<number | null>,

  // Multi-agent outputs (Phase 6)
  workerResults: Annotation<Record<string, unknown>[]>,

  // Graph loop observability
  loopDiagnostics: Annotation<LoopDiagnostics | null>,
  executeDiagnostics: Annotation<ExecuteDiagnostics | null>,

  // Model routing hint
  modelHint: Annotation<'opus' | 'sonnet' | null>,

  /** How to interpret the instruction at the entry gate. */
  runMode: Annotation<'auto' | 'chat' | 'code'>,

  /** Set by gateNode: continue to plan or finish run (Q&A only). */
  gateRoute: Annotation<'plan' | 'end'>,

  /** Per-run model override for the coding/execution role (legacy single field). */
  modelOverride: Annotation<string | null>,

  /** anthropic | openai presets for per-stage defaults (see model-policy). */
  modelFamily: Annotation<'anthropic' | 'openai' | null>,

  /** Per-stage model id overrides (planning, coding, review, summary, intent, chat, …). */
  modelOverrides: Annotation<Record<string, string> | null>,
});

/** Inferred state type from the annotation. */
export type ShipyardStateType = typeof ShipyardState.State;
