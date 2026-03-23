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
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'reviewing'
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
}

export type ReviewDecision = 'continue' | 'done' | 'retry' | 'escalate';

export interface ContextEntry {
  label: string;
  content: string;
  source: 'user' | 'tool' | 'system';
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

  // Telemetry
  tokenUsage: Annotation<{ input: number; output: number } | null>,
  traceUrl: Annotation<string | null>,
  runStartedAt: Annotation<number>,

  // Multi-agent outputs (Phase 6)
  workerResults: Annotation<Record<string, unknown>[]>,

  // Model routing hint
  modelHint: Annotation<'opus' | 'sonnet' | null>,
});

/** Inferred state type from the annotation. */
export type ShipyardStateType = typeof ShipyardState.State;
