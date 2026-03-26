/**
 * Instruction loop: queue + dispatch for the Shipyard graph.
 *
 * Processes one instruction at a time (sequential for MVP).
 * Instructions arrive via REST or WebSocket.
 *
 * Persistence:
 *   - File-based (default outside tests): completed runs are saved to results/<runId>.json
 *   - Postgres (optional): set via setPool() for relational storage
 *   - On init: loads existing runs from results/ so history survives restarts
 */

import { v4 as uuid } from 'uuid';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { createShipyardGraph } from '../graph/builder.js';
import { ContextStore } from '../context/store.js';
import { buildTraceUrl, canTrace, resolveLangSmithRunUrl } from './langsmith.js';
import {
  setLiveFeedListener,
  type LiveFeedEvent,
} from '../tools/hooks.js';
import {
  createRun as persistRunPg,
  saveRunToFile,
  deleteRunFromFile,
  deleteRunFromPg,
  loadRunsFromFiles,
  loadRunFromFile,
  listRuns,
  pgRowToRunSummary,
} from './persistence.js';
import type { Pool } from 'pg';
import type {
  ShipyardStateType,
  ContextEntry,
  LLMMessage,
  LoopDiagnostics,
  PlanStep,
  VerificationResult,
  ToolCallRecord,
} from '../graph/state.js';
import { setRunAbortSignal } from './run-signal.js';
import {
  MODEL_CONFIGS,
  getResolvedModelConfig,
  type ModelRole,
} from '../config/model-policy.js';
import {
  tryArithmeticShortcut,
  tryChatShortcut,
} from '../graph/intent.js';
import {
  deriveNextActions,
  type NextAction,
  appendNextActionsToAssistantMessage,
} from './next-actions.js';
import { setCommandRuntimeControls } from '../graph/commands.js';
import { captureRunBaseline, clearRunBaseline } from './run-baselines.js';
import { WORK_DIR } from '../config/work-dir.js';
import { clearLiveFollowups, enqueueLiveFollowup } from './live-followups.js';
import {
  createLoopGuard,
  formatLoopStopError,
  isGraphRecursionLimitError,
  resolveGraphRecursionLimit,
  resolveGraphSoftBudget,
  withHardRecursionStop,
} from './loop-guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedInstruction {
  id: string;
  instruction: string;
  contexts: ContextEntry[];
  createdAt: number;
  confirmPlan?: boolean;
  /** auto: classify; chat: Q&A only; code: always full pipeline */
  runMode?: 'auto' | 'chat' | 'code';
  kind?: 'new' | 'followup';
  /** Accumulated duration from previous Ask segments (follow-up only). */
  priorDurationMs?: number;
  seedMessages?: LLMMessage[];
  /** Single per-run model override (e.g. claude-haiku-4-5 or gpt-5-mini). */
  modelOverride?: string;
  /** anthropic | openai stage presets when set. */
  modelFamily?: 'anthropic' | 'openai';
  /** Per-stage model ids (planning, coding, review, …). */
  modelOverrides?: Partial<Record<ModelRole, string>>;
  requestedUiMode?: 'ask' | 'plan' | 'agent';
  threadKindHint?: 'ask' | 'plan' | 'agent';
  followupThreadKind?: 'ask' | 'plan' | 'agent';
}

/** Options accepted as the last argument to `submit` instead of a legacy model string. */
export interface SubmitModelOptions {
  modelOverride?: string;
  modelFamily?: 'anthropic' | 'openai';
  modelOverrides?: Partial<Record<ModelRole, string>>;
  requestedUiMode?: 'ask' | 'plan' | 'agent';
  threadKindHint?: 'ask' | 'plan' | 'agent';
  /**
   * When true, omitted model fields should clear prior thread-level selection
   * instead of silently inheriting it.
   */
  replaceModelSelection?: boolean;
}

export type SubmitModelArg = string | SubmitModelOptions | undefined;

export interface RunResult {
  runId: string;
  phase: ShipyardStateType['phase'];
  steps: ShipyardStateType['steps'];
  fileEdits: ShipyardStateType['fileEdits'];
  toolCallHistory: ShipyardStateType['toolCallHistory'];
  tokenUsage: ShipyardStateType['tokenUsage'];
  traceUrl: ShipyardStateType['traceUrl'];
  messages: ShipyardStateType['messages'];
  error: ShipyardStateType['error'];
  verificationResult: VerificationResult | null;
  reviewFeedback: string | null;
  durationMs: number;
  requestedUiMode?: 'ask' | 'plan' | 'agent' | null;
  /** ask: Q&A thread (follow-ups); plan: code with plan review; agent: full auto */
  threadKind?: 'ask' | 'plan' | 'agent';
  runMode?: 'auto' | 'chat' | 'code';
  executionPath?: 'graph' | 'local-shortcut';
  queuedAt?: string;
  startedAt?: string;
  modelOverride?: string | null;
  modelFamily?: 'anthropic' | 'openai' | null;
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
  resolvedModels?: Partial<Record<ModelRole, string>> | null;
  completionStatus?: 'completed' | 'failed' | 'cancelled' | 'cancelled_with_completed_actions';
  cancellation?: {
    reason: string;
    completed_actions: number;
    tool_calls: number;
    edited_files: number;
    source?:
      | 'api'
      | 'ws'
      | 'command'
      | 'shutdown_signal'
      | 'watchdog'
      | 'abort_error'
      | 'unknown';
    requested_at?: string | null;
  } | null;
  loopDiagnostics?: LoopDiagnostics | null;
  savedAt?: string;
  nextActions?: NextAction[];
}

export type StateListener = (state: Partial<ShipyardStateType>) => void;
export type LiveFeedListener = (event: LiveFeedEvent) => void;

function ensureRunMessages(
  instruction: string,
  messages: LLMMessage[] | null | undefined,
): LLMMessage[] {
  const list = Array.isArray(messages) ? [...messages] : [];
  const trimmed = instruction.trim();
  if (!trimmed) return list;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg?.role === 'user') {
      return msg.content.trim() === trimmed
        ? list
        : [...list, { role: 'user', content: trimmed }];
    }
  }
  return [{ role: 'user', content: trimmed }, ...list];
}

function ensureAssistantReplyForLatestTurn(
  messages: LLMMessage[],
  phase: ShipyardStateType['phase'],
  error: string | null | undefined,
): LLMMessage[] {
  const list = Array.isArray(messages) ? [...messages] : [];
  let lastUserIdx = -1;
  let lastAssistantIdx = -1;
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i];
    if (msg?.role === 'user') lastUserIdx = i;
    if (msg?.role === 'assistant') lastAssistantIdx = i;
  }
  if (lastUserIdx === -1 || lastAssistantIdx > lastUserIdx) return list;

  const fallback =
    phase === 'error'
      ? `I hit an error while handling this request: ${error ?? 'unknown error'}. I can retry with a focused fix plan.`
      : 'Done. I completed this request and can continue with the next step.';
  return [...list, { role: 'assistant', content: fallback }];
}

function buildLocalAskReply(instruction: string): string | null {
  const arithmetic = tryArithmeticShortcut(instruction);
  if (arithmetic !== null) {
    return `Reasoning: arithmetic only, no repo work needed.\n\nAnswer: ${arithmetic}`;
  }
  return tryChatShortcut(instruction);
}

function toolRecordFromLiveFeed(
  event: Extract<LiveFeedEvent, { type: 'tool' }>,
): ToolCallRecord {
  const toolInput: Record<string, unknown> =
    event.tool_name === 'bash'
      ? { command: event.detail }
      : event.tool_name === 'ls'
        ? { path: event.detail }
        : event.file_path
          ? { file_path: event.file_path, summary: event.detail }
          : { summary: event.detail };

  return {
    tool_name: event.tool_name,
    tool_input: toolInput,
    tool_result: JSON.stringify({ success: event.ok }),
    timestamp: event.timestamp,
    duration_ms: 0,
  };
}

const MODEL_ROLES = Object.keys(MODEL_CONFIGS) as ModelRole[];

function resolveModelsForRun(opts: {
  modelOverride?: string | null;
  modelFamily?: 'anthropic' | 'openai' | null;
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
}): Partial<Record<ModelRole, string>> {
  const resolved: Partial<Record<ModelRole, string>> = {};
  for (const role of MODEL_ROLES) {
    resolved[role] = getResolvedModelConfig(role, {
      legacyCodingOverride: opts.modelOverride ?? null,
      modelFamily: opts.modelFamily ?? null,
      modelOverrides: opts.modelOverrides ?? null,
    }).model;
  }
  return resolved;
}

function preferNonEmptyArray<T>(
  primary: T[] | null | undefined,
  fallback: T[] | null | undefined,
): T[] {
  if (Array.isArray(primary) && primary.length > 0) return primary;
  return Array.isArray(fallback) ? fallback : [];
}

function getRunStartPhase(
  runMode: 'auto' | 'chat' | 'code' | undefined,
  threadKind?: 'ask' | 'plan' | 'agent',
): ShipyardStateType['phase'] {
  if (runMode === 'code') return 'planning';
  if (threadKind === 'plan' || threadKind === 'agent') return 'planning';
  return 'routing';
}

const MAX_CONTINUATION_ITEMS = 24;
const MAX_CONTINUATION_CHARS = 12_000;

function truncateValue(value: string, max = 480): string {
  const text = value.trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const file = input['file_path'];
  if (typeof file === 'string' && file.trim()) return file;
  const command = input['command'];
  if (typeof command === 'string' && command.trim()) return truncateValue(command, 160);
  const summary = input['summary'];
  if (typeof summary === 'string' && summary.trim()) return truncateValue(summary, 160);
  return truncateValue(JSON.stringify(input), 160);
}

function compactAbsolutePath(path: string): string {
  return path.replace(/^\/+/, '/');
}

function buildContinuationContext(run: RunResult): ContextEntry | null {
  const editedFiles = [...new Set(
    (run.fileEdits ?? [])
      .map((e) => e.file_path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0),
  )].slice(0, MAX_CONTINUATION_ITEMS);

  const pendingSteps = (run.steps ?? [])
    .filter((s) => s.status !== 'done')
    .slice(0, 8)
    .map((s) => `${s.index + 1}. ${truncateValue(s.description, 180)}`);

  const recentTools = (run.toolCallHistory ?? [])
    .slice(-MAX_CONTINUATION_ITEMS)
    .map((call) => `- ${call.tool_name}: ${summarizeToolInput(call.tool_input)}`);

  const lastAssistant = [...(run.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant')?.content ?? '';

  if (
    editedFiles.length === 0 &&
    pendingSteps.length === 0 &&
    recentTools.length === 0 &&
    !lastAssistant.trim()
  ) {
    return null;
  }

  const lines: string[] = [
    `Run ID: ${run.runId}`,
    `Previous phase: ${run.phase}`,
    `Thread kind: ${run.threadKind ?? 'unknown'}`,
    `Duration so far: ${run.durationMs}ms`,
    run.error ? `Previous error: ${truncateValue(run.error, 260)}` : '',
    '',
    `Completed steps: ${(run.steps ?? []).filter((s) => s.status === 'done').length}/${run.steps?.length ?? 0}`,
    pendingSteps.length > 0 ? 'Pending steps:' : '',
    ...pendingSteps.map((s) => `- ${s}`),
    '',
    editedFiles.length > 0 ? `Edited files (${editedFiles.length}):` : '',
    ...editedFiles.map((p) => `- ${compactAbsolutePath(p)}`),
    '',
    recentTools.length > 0 ? `Recent tool activity (${recentTools.length}):` : '',
    ...recentTools,
    '',
    lastAssistant.trim()
      ? `Most recent assistant summary:\n${truncateValue(lastAssistant, 1200)}`
      : '',
    '',
    'Instruction for this turn: continue from the known state first, then explore only gaps.',
  ].filter(Boolean);

  const content = lines.join('\n');
  if (!content.trim()) return null;

  return {
    label: 'Thread Continuation Snapshot',
    content: content.slice(0, MAX_CONTINUATION_CHARS),
    source: 'system',
  };
}

// ---------------------------------------------------------------------------
// Instruction loop
// ---------------------------------------------------------------------------

export class InstructionLoop {
  private queue: QueuedInstruction[] = [];
  private processing = false;
  private currentRunId: string | null = null;
  private abortController: AbortController | null = null;
  /** Set when user calls cancel(); checked each graph stream chunk to stop the run. */
  private cancelRequested = false;
  private cancelSource: NonNullable<RunResult['cancellation']>['source'] = 'unknown';
  private cancelRequestedAt: number | null = null;
  private contextStore = new ContextStore();
  private runs: Map<string, RunResult> = new Map();
  private listeners: Set<StateListener> = new Set();
  private liveFeedListeners: Set<LiveFeedListener> = new Set();
  private pool: Pool | null = null;
  private initialized = false;
  private checkpointer: BaseCheckpointSaver = new MemorySaver();
  private checkpointerReady: Promise<void> | null = null;
  /** Runs waiting for user to confirm the plan before execution proceeds. */
  private pendingConfirm: Map<string, {
    resolve: (steps: PlanStep[] | null) => void;
  }> = new Map();

  constructor() {
    setCommandRuntimeControls({
      getStatus: () => this.getStatus(),
      cancel: () => this.cancel('command'),
      resume: (runId: string) => this.resume(runId),
    });
  }

  /** User requested pause between graph steps (Agent / Plan runs). */
  private pauseRequested = false;
  private pauseResumeWaiters: Array<() => void> = [];

  /** Set a pg Pool for optional run persistence. */
  setPool(pool: Pool): void {
    this.pool = pool;
    const pgCheckpointer = new PostgresSaver(pool);
    this.checkpointer = pgCheckpointer;
    this.checkpointerReady = pgCheckpointer.setup().then(() => {
      console.log('[loop] postgres checkpointer ready');
    }).catch((err) => {
      console.warn('[loop] postgres checkpointer setup failed, using memory saver:', err);
      this.checkpointer = new MemorySaver();
    });
  }

  private async ensureCheckpointerReady(): Promise<BaseCheckpointSaver> {
    if (this.checkpointerReady) {
      await this.checkpointerReady.catch(() => {});
      this.checkpointerReady = null;
    }
    return this.checkpointer;
  }

  /**
   * Initialize the loop: load persisted runs from disk.
   * Safe to call multiple times (no-op after first).
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const loaded = loadRunsFromFiles();
      for (const run of loaded) {
        this.runs.set(run.runId, run);
      }
      if (loaded.length > 0) {
        console.log(`[loop] loaded ${loaded.length} persisted run(s) from disk`);
      }
    } catch (err) {
      console.error('[loop] failed to load persisted runs:', err);
    }
  }

  /** Add a state change listener (for WebSocket broadcasting). */
  onStateChange(fn: StateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Add a live-feed listener (file edits + tool activity for dashboard WS). */
  onLiveFeed(fn: LiveFeedListener): () => void {
    this.liveFeedListeners.add(fn);
    return () => this.liveFeedListeners.delete(fn);
  }

  private broadcastLiveFeed(event: LiveFeedEvent): void {
    const runId = this.currentRunId;
    if (runId) {
      const current = this.runs.get(runId);
      if (current) {
        if (event.type === 'file_edit') {
          this.runs.set(runId, {
            ...current,
            fileEdits: [...current.fileEdits, event.edit],
          });
        } else if (event.type === 'tool') {
          this.runs.set(runId, {
            ...current,
            toolCallHistory: [
              ...current.toolCallHistory,
              toolRecordFromLiveFeed(event),
            ],
          });
        }
      }
    }
    for (const fn of this.liveFeedListeners) {
      try {
        fn(event);
      } catch {
        // Listener errors don't crash the loop
      }
    }
  }

  private broadcast(state: Partial<ShipyardStateType>): void {
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch {
        // Listener errors don't crash the loop
      }
    }
  }

  /** Submit an instruction to the queue. */
  submit(
    instruction: string,
    contexts?: ContextEntry[],
    confirmPlan?: boolean,
    runMode?: 'auto' | 'chat' | 'code',
    modelArg?: SubmitModelArg,
  ): string {
    this.init();
    const id = uuid();
    let modelOverride: string | undefined;
    let modelFamily: 'anthropic' | 'openai' | undefined;
    let modelOverrides: Partial<Record<ModelRole, string>> | undefined;
    let replaceModelSelection = false;
    let requestedUiMode: 'ask' | 'plan' | 'agent' | undefined;
    let threadKindHint: 'ask' | 'plan' | 'agent' | undefined;
    if (typeof modelArg === 'string') {
      modelOverride = modelArg.trim() || undefined;
    } else if (modelArg && typeof modelArg === 'object') {
      modelOverride = modelArg.modelOverride?.trim() || undefined;
      modelFamily = modelArg.modelFamily;
      modelOverrides = modelArg.modelOverrides;
      replaceModelSelection = modelArg.replaceModelSelection === true;
      requestedUiMode = modelArg.requestedUiMode;
      threadKindHint = modelArg.threadKindHint;
    }
    if (
      (runMode ?? 'auto') !== 'code' &&
      !confirmPlan &&
      (!contexts || contexts.length === 0) &&
      this.completeLocalAsk(id, instruction, undefined, {
        createdAt: Date.now(),
        runMode: runMode ?? 'auto',
        modelOverride,
        modelFamily,
        modelOverrides,
        requestedUiMode,
      })
    ) {
      return id;
    }
    this.queue.push({
      id,
      instruction,
      contexts: contexts ?? [],
      createdAt: Date.now(),
      confirmPlan: confirmPlan ?? false,
      runMode: runMode ?? 'auto',
      modelOverride,
      modelFamily,
      modelOverrides,
      requestedUiMode,
      threadKindHint,
    });
    const queuedAtIso = new Date().toISOString();
    if (!this.runs.has(id)) {
      this.runs.set(id, {
        runId: id,
        phase: getRunStartPhase(runMode, threadKindHint),
        steps: [],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: null,
        traceUrl: null,
        messages: ensureRunMessages(instruction, []),
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 0,
        requestedUiMode: requestedUiMode ?? null,
        threadKind: threadKindHint,
        runMode: runMode ?? 'auto',
        executionPath: 'graph',
        queuedAt: queuedAtIso,
        startedAt: queuedAtIso,
        modelOverride: modelOverride ?? null,
        modelFamily: modelFamily ?? null,
        modelOverrides: modelOverrides ?? null,
        resolvedModels: resolveModelsForRun({
          modelOverride: modelOverride ?? null,
          modelFamily: modelFamily ?? null,
          modelOverrides: modelOverrides ?? null,
        }),
        loopDiagnostics: null,
        savedAt: queuedAtIso,
        nextActions: [],
      });
    }
    void this.processNext();
    return id;
  }

  /**
   * Resume a previously interrupted run by re-submitting it.
   * Returns the runId if the run was found and re-queued, null otherwise.
   */
  resume(runId: string): string | null {
    this.init();

    // Check in-memory first, then try loading from disk
    let existing = this.runs.get(runId) ?? null;
    if (!existing) {
      existing = loadRunFromFile(runId);
    }
    if (!existing) return null;

    // Only resume runs that didn't finish
    if (existing.phase === 'done') return null;

    // Extract the original instruction from messages
    const instruction =
      existing.messages.find((m) => m.role === 'user')?.content ?? '';
    if (!instruction) return null;

    const threadKind =
      existing.threadKind ??
      (existing.runMode === 'chat'
        ? 'ask'
        : existing.runMode === 'code'
          ? 'agent'
          : 'ask');

    // Re-queue with the same ID and prior thread context
    this.queue.push({
      id: runId,
      instruction,
      contexts: [],
      createdAt: Date.now(),
      kind: 'followup',
      runMode: threadKind === 'ask' ? 'chat' : 'code',
      confirmPlan: threadKind === 'plan',
      priorDurationMs: existing.durationMs,
      seedMessages: existing.messages,
      requestedUiMode: existing.requestedUiMode ?? undefined,
      modelOverride: existing.modelOverride ?? undefined,
      modelFamily: existing.modelFamily ?? undefined,
      modelOverrides: existing.modelOverrides ?? undefined,
      followupThreadKind: threadKind,
    });
    void this.processNext();
    return runId;
  }

  /** Inject context mid-run. */
  injectContext(entry: ContextEntry): void {
    this.contextStore.add(entry);
  }

  /** Cancel current run (stops consuming the graph stream; persists partial state as error). */
  cancel(
    source: NonNullable<RunResult['cancellation']>['source'] = 'unknown',
  ): boolean {
    if (!this.processing || !this.currentRunId) return false;
    this.cancelRequested = true;
    this.cancelSource = source;
    this.cancelRequestedAt = Date.now();
    this.pauseRequested = false;
    const waiters = this.pauseResumeWaiters.splice(0);
    for (const w of waiters) w();
    try {
      this.abortController?.abort();
    } catch {
      /* ignore */
    }
    return true;
  }

  /** Pause after the current graph step completes (Agent / Plan runs). */
  requestPause(): boolean {
    if (!this.processing) return false;
    this.pauseRequested = true;
    return true;
  }

  /** Continue after a pause between steps. */
  resumeFromPause(): void {
    this.pauseRequested = false;
    const waiters = this.pauseResumeWaiters.splice(0);
    for (const w of waiters) w();
  }

  /**
   * Append a user message to an Ask thread (same runId, shared message history).
   * Accepts queued follow-ups and preserves ordering within the thread.
   */
  followUpAsk(
    runId: string,
    instruction: string,
    modelArg?: SubmitModelArg,
  ): boolean {
    return this.followUpThread(runId, instruction, modelArg);
  }

  followUpThread(
    runId: string,
    instruction: string,
    modelArg?: SubmitModelArg,
  ): boolean {
    this.init();
    const trimmed = instruction.trim();
    if (!trimmed) return false;

    let modelOverride: string | undefined;
    let modelFamily: 'anthropic' | 'openai' | undefined;
    let modelOverrides: Partial<Record<ModelRole, string>> | undefined;
    let replaceModelSelection = false;
    let requestedUiMode: 'ask' | 'plan' | 'agent' | undefined;
    let threadKindHint: 'ask' | 'plan' | 'agent' | undefined;
    if (typeof modelArg === 'string') {
      modelOverride = modelArg.trim() || undefined;
    } else if (modelArg && typeof modelArg === 'object') {
      modelOverride = modelArg.modelOverride?.trim() || undefined;
      modelFamily = modelArg.modelFamily;
      modelOverrides = modelArg.modelOverrides;
      replaceModelSelection = modelArg.replaceModelSelection === true;
      requestedUiMode = modelArg.requestedUiMode;
      threadKindHint = modelArg.threadKindHint;
    }

    let existing = this.runs.get(runId) ?? null;
    if (!existing) existing = loadRunFromFile(runId);
    if (!existing) return false;
    const existingThreadKind =
      existing.threadKind ??
      (existing.runMode === 'chat'
        ? 'ask'
        : existing.runMode === 'code'
          ? 'agent'
          : 'ask');
    const threadKind = threadKindHint ?? existingThreadKind;
    const effectiveRequestedUiMode =
      requestedUiMode ?? existing.requestedUiMode ?? null;
    if (
      (threadKindHint &&
        (existing.threadKind !== threadKindHint ||
          existing.runMode !== (threadKindHint === 'ask' ? 'chat' : 'code'))) ||
      existing.requestedUiMode !== effectiveRequestedUiMode
    ) {
      existing = {
        ...existing,
        requestedUiMode: effectiveRequestedUiMode ?? null,
        threadKind: threadKindHint ?? existing.threadKind,
        runMode: threadKindHint
          ? (threadKindHint === 'ask' ? 'chat' : 'code')
          : existing.runMode,
      };
      this.runs.set(runId, existing);
    }
    const effectiveModelOverride = replaceModelSelection
      ? modelOverride
      : modelOverride ?? existing.modelOverride ?? undefined;
    const effectiveModelFamily = replaceModelSelection
      ? modelFamily
      : modelFamily ?? existing.modelFamily ?? undefined;
    const effectiveModelOverrides = replaceModelSelection
      ? modelOverrides
      : modelOverrides ?? existing.modelOverrides ?? undefined;
    const hasPendingForRun =
      this.currentRunId === runId ||
      this.queue.some((item) => item.id === runId && item.kind === 'followup');
    if (
      this.processing &&
      this.currentRunId === runId &&
      threadKind !== 'ask'
    ) {
      enqueueLiveFollowup(runId, trimmed);
      return true;
    }

    if (
      threadKind === 'ask' &&
      existing.phase === 'done' &&
      !hasPendingForRun &&
      this.completeLocalAsk(runId, trimmed, existing, {
        createdAt: Date.now(),
        runMode: 'chat',
        modelOverride: effectiveModelOverride,
        modelFamily: effectiveModelFamily,
        modelOverrides: effectiveModelOverrides,
        requestedUiMode: effectiveRequestedUiMode ?? undefined,
      })
    ) return true;

    this.queue.push({
      id: runId,
      instruction: trimmed,
      contexts: [],
      createdAt: Date.now(),
      kind: 'followup',
      runMode: threadKind === 'ask' ? 'chat' : 'code',
      confirmPlan: threadKind === 'plan',
      priorDurationMs: existing.durationMs,
      requestedUiMode: effectiveRequestedUiMode ?? undefined,
      modelOverride: effectiveModelOverride,
      modelFamily: effectiveModelFamily,
      modelOverrides: effectiveModelOverrides,
      threadKindHint,
      followupThreadKind: threadKind,
    });
    void this.processNext();
    return true;
  }

  /**
   * Confirm a plan that is awaiting user approval.
   * Optionally pass edited steps to replace the planner's steps.
   */
  confirmPlan(
    runId: string,
    editedSteps?: Array<{ index: number; description: string; files: string[] }>,
  ): boolean {
    const pending = this.pendingConfirm.get(runId);
    if (!pending) return false;
    this.pendingConfirm.delete(runId);

    if (editedSteps) {
      const steps: PlanStep[] = editedSteps.map((s) => ({
        index: s.index,
        description: s.description,
        files: s.files,
        status: 'pending' as const,
      }));
      pending.resolve(steps);
    } else {
      pending.resolve(null);
    }
    return true;
  }

  /** Get run result by ID. */
  getRun(id: string): RunResult | undefined {
    this.init();
    return this.runs.get(id);
  }

  /**
   * Remove a run from memory, results file, and Postgres (when configured).
   * Refuses while that run is the one currently executing (stop it first).
   */
  async deleteRun(
    runId: string,
  ): Promise<{ ok: true } | { ok: false; error: string; code: 'active' | 'not_found' }> {
    this.init();
    if (this.processing && this.currentRunId === runId) {
      return {
        ok: false,
        error: 'This run is still active. Stop it, then delete.',
        code: 'active',
      };
    }
    const hadMem = this.runs.delete(runId);
    const fileDeleted = deleteRunFromFile(runId);
    let pgDeleted = 0;
    if (this.pool) {
      try {
        pgDeleted = await deleteRunFromPg(this.pool, runId);
      } catch (err) {
        console.error('[loop] pg delete failed:', err);
      }
    }
    if (!hadMem && !fileDeleted && pgDeleted === 0) {
      return { ok: false, error: 'Run not found.', code: 'not_found' };
    }
    return { ok: true };
  }

  /** Remove a context by label. */
  removeContext(label: string): boolean {
    return this.contextStore.remove(label);
  }

  /** List all active contexts. */
  getContexts(): Array<{ label: string; content: string; source: string }> {
    return this.contextStore.getAll();
  }

  /** Get all run results. */
  getAllRuns(): RunResult[] {
    this.init();
    return Array.from(this.runs.values());
  }

  /** Get paginated run results. */
  getRunsPaginated(limit: number, offset: number): RunResult[] {
    this.init();
    const all = Array.from(this.runs.values());
    return all.slice(offset, offset + limit);
  }

  /**
   * Runs for dashboard and GET /api/runs: in-memory (from results/*.json) merged with
   * Postgres rows that are not in memory, sorted by savedAt descending.
   */
  async getRunsForListingAsync(
    limit: number,
    offset = 0,
  ): Promise<RunResult[]> {
    this.init();
    const map = new Map<string, RunResult>();
    for (const r of this.runs.values()) {
      map.set(r.runId, r);
    }
    if (this.pool) {
      const rows = await listRuns(this.pool, Math.max(limit + offset, 200));
      for (const row of rows) {
        const id = String(row['id'] ?? '');
        if (!id || map.has(id)) continue;
        map.set(id, pgRowToRunSummary(row));
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) =>
      (b.savedAt ?? '').localeCompare(a.savedAt ?? ''),
    );
    return sorted.slice(offset, offset + limit);
  }

  /** Get current queue status. */
  getStatus(): {
    processing: boolean;
    currentRunId: string | null;
    queueLength: number;
    pauseRequested: boolean;
  } {
    return {
      processing: this.processing,
      currentRunId: this.currentRunId,
      queueLength: this.queue.length,
      pauseRequested: this.pauseRequested,
    };
  }

  private resolveThreadKind(
    item: QueuedInstruction,
    fs: ShipyardStateType,
  ): 'ask' | 'plan' | 'agent' {
    if (item.kind === 'followup') return item.followupThreadKind ?? 'ask';
    if (item.runMode === 'chat') return 'ask';
    if (item.runMode === 'code') {
      return item.confirmPlan ? 'plan' : 'agent';
    }
    const touchedRepo =
      (fs.steps?.length ?? 0) > 0 || (fs.fileEdits?.length ?? 0) > 0;
    if (!touchedRepo && fs.phase === 'done') return 'ask';
    return item.confirmPlan ? 'plan' : 'agent';
  }

  private async waitPauseBetweenSteps(runId: string): Promise<void> {
    while (this.pauseRequested && !this.cancelRequested) {
      this.broadcast({
        phase: 'paused',
        runId,
      });
      await new Promise<void>((resolve) => {
        this.pauseResumeWaiters.push(resolve);
      });
    }
  }

  /**
   * Persist a run result to file (when enabled) and Postgres (if pool set).
   * Never throws — logs errors and continues.
   */
  private persistRun(runResult: RunResult): void {
    // Save to file when runtime persistence is enabled
    try {
      const path = saveRunToFile(runResult);
      if (path) console.log(`[persistence] saved ${runResult.runId} -> ${path}`);
    } catch (err) {
      console.error('[persistence] file save failed:', err);
    }

    // Optionally save to Postgres
    if (this.pool) {
      persistRunPg(this.pool, runResult).catch((e) =>
        console.error('[persistence] pg save failed:', e),
      );
    }
  }

  private broadcastThreadKind(
    runId: string,
    phase: ShipyardStateType['phase'],
    threadKind: 'ask' | 'plan' | 'agent',
  ): void {
    for (const fn of this.listeners) {
      try {
        fn({ runId, phase, threadKind } as Partial<ShipyardStateType> & { threadKind?: string });
      } catch {
        /* ignore */
      }
    }
  }

  private resolveTraceUrlInBackground(runId: string): void {
    if (!canTrace()) return;
    void resolveLangSmithRunUrl(runId)
      .then((publicUrl) => {
        if (!publicUrl) return;
        const current = this.runs.get(runId);
        if (!current || current.traceUrl === publicUrl) return;
        const updated: RunResult = {
          ...current,
          traceUrl: publicUrl,
          savedAt: new Date().toISOString(),
        };
        this.runs.set(runId, updated);
        this.persistRun(updated);
        this.broadcast({
          runId,
          phase: updated.phase,
          traceUrl: publicUrl,
        });
      })
      .catch((err) => {
        console.warn('[loop] failed to resolve LangSmith public trace URL:', err);
      });
  }

  private completeLocalAsk(
    runId: string,
    instruction: string,
    existing?: RunResult | null,
    meta?: {
      createdAt?: number;
      runMode?: 'auto' | 'chat' | 'code';
      modelOverride?: string;
      modelFamily?: 'anthropic' | 'openai';
      modelOverrides?: Partial<Record<ModelRole, string>>;
      requestedUiMode?: 'ask' | 'plan' | 'agent';
    },
  ): boolean {
    const reply = buildLocalAskReply(instruction);
    if (reply === null) return false;
    const now = Date.now();
    const queuedMs = meta?.createdAt ?? now;
    const startedMs = queuedMs;
    const resolvedModels = resolveModelsForRun({
      modelOverride: meta?.modelOverride ?? existing?.modelOverride ?? null,
      modelFamily: meta?.modelFamily ?? existing?.modelFamily ?? null,
      modelOverrides: meta?.modelOverrides ?? existing?.modelOverrides ?? null,
    });

    const runResult: RunResult = {
      runId,
      phase: 'done',
      steps: existing?.steps ?? [],
      fileEdits: existing?.fileEdits ?? [],
      toolCallHistory: existing?.toolCallHistory ?? [],
      tokenUsage: existing?.tokenUsage ?? null,
      traceUrl: existing?.traceUrl ?? null,
      messages: [
        ...(existing?.messages ?? []),
        { role: 'user', content: instruction },
        { role: 'assistant', content: reply },
      ],
      error: null,
      verificationResult: existing?.verificationResult ?? null,
      reviewFeedback: existing?.reviewFeedback ?? null,
      durationMs: (existing?.durationMs ?? 0) + Math.max(0, now - startedMs),
      requestedUiMode: meta?.requestedUiMode ?? existing?.requestedUiMode ?? null,
      threadKind: 'ask',
      runMode: meta?.runMode ?? existing?.runMode ?? 'chat',
      executionPath: 'local-shortcut',
      queuedAt: new Date(queuedMs).toISOString(),
      startedAt: new Date(startedMs).toISOString(),
      modelOverride: meta?.modelOverride ?? existing?.modelOverride ?? null,
      modelFamily: meta?.modelFamily ?? existing?.modelFamily ?? null,
      modelOverrides: meta?.modelOverrides ?? existing?.modelOverrides ?? null,
      resolvedModels,
      loopDiagnostics: existing?.loopDiagnostics ?? null,
      completionStatus: 'completed',
      cancellation: null,
      savedAt: new Date(now).toISOString(),
    };
    runResult.messages = ensureAssistantReplyForLatestTurn(
      runResult.messages,
      runResult.phase,
      runResult.error,
    );
    runResult.nextActions = deriveNextActions(runResult);
    runResult.messages = appendNextActionsToAssistantMessage(
      runResult.messages,
      runResult.nextActions,
    );

    this.runs.set(runId, runResult);
    this.persistRun(runResult);
    this.broadcast({
      runId,
      phase: 'done',
      steps: runResult.steps,
      fileEdits: runResult.fileEdits,
      toolCallHistory: runResult.toolCallHistory,
      tokenUsage: runResult.tokenUsage,
      error: null,
      verificationResult: runResult.verificationResult,
      reviewFeedback: runResult.reviewFeedback,
      messages: runResult.messages,
    });
    this.broadcastThreadKind(runId, 'done', 'ask');
    return true;
  }

  /** Process next instruction in the queue. */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const item = this.queue.shift()!;
    this.currentRunId = item.id;
    this.cancelRequested = false;
    this.cancelSource = 'unknown';
    this.cancelRequestedAt = null;
    this.pauseRequested = false;
    this.abortController = new AbortController();
    setRunAbortSignal(this.abortController.signal);

    const isFollowup = item.kind === 'followup';
    const priorDuration = item.priorDurationMs ?? 0;
    const queuedAtIso = new Date(item.createdAt).toISOString();

    // Add contexts from the instruction
    for (const ctx of item.contexts) {
      this.contextStore.add(ctx);
    }

    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const resolvedModels = resolveModelsForRun({
      modelOverride: item.modelOverride ?? null,
      modelFamily: item.modelFamily ?? null,
      modelOverrides: item.modelOverrides ?? null,
    });
    const followupThreadKind = item.followupThreadKind ?? 'ask';

    // Store an in-progress placeholder so GET /api/runs/:id doesn't 404
    // while graph.invoke() is blocking.
    const priorSnap =
      isFollowup
        ? (this.runs.get(item.id) ?? loadRunFromFile(item.id) ?? undefined)
        : undefined;
    const continuationContext =
      isFollowup && followupThreadKind !== 'ask' && priorSnap
        ? buildContinuationContext(priorSnap)
        : null;
    const seedMsgs = isFollowup
      ? (item.seedMessages ?? priorSnap?.messages ?? [])
      : [];
    const startPhase = getRunStartPhase(item.runMode, followupThreadKind);
    const inProgressRun: RunResult = isFollowup
      ? {
          runId: item.id,
          phase: startPhase,
          steps: [],
          fileEdits: [],
          toolCallHistory: [],
          tokenUsage: priorSnap?.tokenUsage ?? null,
          traceUrl: priorSnap?.traceUrl ?? null,
          messages: ensureRunMessages(item.instruction, seedMsgs),
          error: null,
          verificationResult: null,
          reviewFeedback: null,
          durationMs: priorDuration,
          requestedUiMode:
            item.requestedUiMode ?? priorSnap?.requestedUiMode ?? null,
          threadKind: followupThreadKind,
          runMode: item.runMode ?? (followupThreadKind === 'ask' ? 'chat' : 'code'),
          executionPath: 'graph',
          queuedAt: queuedAtIso,
          startedAt: startedAtIso,
          modelOverride: item.modelOverride ?? null,
          modelFamily: item.modelFamily ?? null,
          modelOverrides: item.modelOverrides ?? null,
          resolvedModels,
          loopDiagnostics: priorSnap?.loopDiagnostics ?? null,
          savedAt: new Date().toISOString(),
          nextActions: [],
        }
      : {
          runId: item.id,
          phase: startPhase,
          steps: [],
          fileEdits: [],
          toolCallHistory: [],
          tokenUsage: null,
          traceUrl: null,
          messages: ensureRunMessages(item.instruction, []),
          error: null,
          verificationResult: null,
          reviewFeedback: null,
          durationMs: 0,
          requestedUiMode: item.requestedUiMode ?? null,
          threadKind: item.threadKindHint,
          runMode: item.runMode ?? 'auto',
          executionPath: 'graph',
          queuedAt: queuedAtIso,
          startedAt: startedAtIso,
          modelOverride: item.modelOverride ?? null,
          modelFamily: item.modelFamily ?? null,
          modelOverrides: item.modelOverrides ?? null,
          resolvedModels,
          loopDiagnostics: null,
          savedAt: new Date().toISOString(),
          nextActions: [],
        };
    this.runs.set(item.id, inProgressRun);

    // Update the in-progress run whenever state changes are broadcast
    const unsubProgress = this.onStateChange((state) => {
      const current = this.runs.get(item.id);
      if (!current) return;
      this.runs.set(item.id, {
        ...current,
        phase: state.phase ?? current.phase,
        steps: state.steps ?? current.steps,
        fileEdits: Array.isArray(state.fileEdits)
          ? preferNonEmptyArray(state.fileEdits, current.fileEdits)
          : current.fileEdits,
        toolCallHistory: Array.isArray(state.toolCallHistory)
          ? preferNonEmptyArray(state.toolCallHistory, current.toolCallHistory)
          : current.toolCallHistory,
        tokenUsage: state.tokenUsage ?? current.tokenUsage,
        error: state.error ?? current.error,
        verificationResult:
          state.verificationResult !== undefined
            ? state.verificationResult
            : current.verificationResult,
        reviewFeedback:
          state.reviewFeedback !== undefined
            ? state.reviewFeedback
            : current.reviewFeedback,
        messages:
          state.messages !== undefined
            ? ensureRunMessages(item.instruction, state.messages)
            : current.messages,
        loopDiagnostics:
          state.loopDiagnostics !== undefined
            ? state.loopDiagnostics
            : current.loopDiagnostics ?? null,
        durationMs: priorDuration + (Date.now() - startedAt),
        threadKind: current.threadKind,
      });
    });

    let finalState: ShipyardStateType | undefined;
    let latestLoopDiagnostics: LoopDiagnostics | null = null;
    const recursionLimit = resolveGraphRecursionLimit();
    const softBudget = resolveGraphSoftBudget(recursionLimit);

    try {
      await captureRunBaseline(item.id, WORK_DIR);
      const checkpointer = await this.ensureCheckpointerReady();
      const graph = createShipyardGraph({ checkpointer });

      const initialPhase = getRunStartPhase(item.runMode, followupThreadKind);
      const initialState: ShipyardStateType = {
        runId: item.id,
        traceId: uuid(),
        instruction: item.instruction,
        phase: initialPhase as ShipyardStateType['phase'],
        steps: [],
        currentStepIndex: 0,
        fileEdits: [],
        toolCallHistory: [],
        verificationResult: null,
        reviewDecision: null,
        reviewFeedback: null,
        contexts: continuationContext
          ? [...this.contextStore.getAll(), continuationContext]
          : this.contextStore.getAll(),
        messages: ensureRunMessages(item.instruction, [...seedMsgs]),
        error: null,
        retryCount: 0,
        maxRetries: 3,
        tokenUsage: null,
        traceUrl: null,
        runStartedAt: startedAt,
        fileOverlaySnapshots: null,
        estimatedCost: null,
        workerResults: [],
        modelHint: 'opus',
        runMode: item.runMode ?? 'auto',
        gateRoute: 'plan',
        modelOverride: item.modelOverride ?? null,
        modelFamily: item.modelFamily ?? null,
        modelOverrides: item.modelOverrides
          ? { ...item.modelOverrides }
          : null,
        loopDiagnostics: null,
      };
      const loopGuard = createLoopGuard({
        recursionLimit,
        softBudget,
        initialState,
        useDynamicSoftBudget: !process.env['SHIPYARD_GRAPH_SOFT_BUDGET']?.trim(),
      });
      initialState.loopDiagnostics = loopGuard.current();
      latestLoopDiagnostics = initialState.loopDiagnostics;

      this.broadcast(initialState);

      // Stream file edits + tool calls to dashboard while the graph runs
      setLiveFeedListener((event) => this.broadcastLiveFeed(event));

      // Use stream() instead of invoke() so we get phase updates mid-execution.
      // Each yielded chunk is { [nodeName]: partialState }.
      finalState = initialState;
      const stream = await graph.stream(initialState, {
        recursionLimit,
        configurable: { thread_id: item.id },
        streamMode: 'updates',
        runId: item.id,
        runName: `shipyard-${item.id.slice(0, 8)}`,
        tags: ['shipyard'],
      });

      let waitingForConfirm = false;
      const allowStepPause =
        !isFollowup &&
        item.runMode !== 'chat' &&
        (item.runMode === 'code' || item.runMode === 'auto');

      for await (const chunk of stream) {
        if (this.cancelRequested) break;
        const nodeUpdates = Object.values(
          chunk as Record<string, Partial<ShipyardStateType>>,
        );
        for (const update of nodeUpdates) {
          const priorState = finalState;
          const mergedState = {
            ...finalState,
            ...update,
          } as ShipyardStateType;
          const diagnostics = loopGuard.observe(priorState, mergedState);
          latestLoopDiagnostics = diagnostics;
          finalState = {
            ...mergedState,
            loopDiagnostics: diagnostics,
          };
          this.broadcast({
            ...update,
            loopDiagnostics: diagnostics,
          });
          if (diagnostics.stopReason) {
            throw new Error(formatLoopStopError(diagnostics));
          }
        }

        // Plan-then-confirm: after the plan node emits steps, pause
        // for user approval before the execute node runs.
        if (
          item.confirmPlan &&
          !waitingForConfirm &&
          finalState.phase === 'executing' &&
          finalState.steps?.length > 0
        ) {
          waitingForConfirm = true;
          this.broadcast({
            ...finalState,
            phase: 'awaiting_confirmation' as ShipyardStateType['phase'],
            runId: item.id,
          });

          const confirmedSteps = await new Promise<PlanStep[] | null>(
            (resolve) => {
              this.pendingConfirm.set(item.id, { resolve });
            },
          );

          if (confirmedSteps) {
            finalState = {
              ...finalState,
              steps: confirmedSteps,
              currentStepIndex: 0,
            };
          }
          this.broadcast({
            ...finalState,
            phase: 'executing',
            runId: item.id,
          });
        }

        if (allowStepPause) {
          await this.waitPauseBetweenSteps(item.id);
        }
      }

      const threadKind = this.resolveThreadKind(item, finalState!);
      const totalDuration = priorDuration + (Date.now() - startedAt);
      const current = this.runs.get(item.id);

      if (this.cancelRequested) {
        const cancelSource = this.cancelSource ?? 'unknown';
        const cancelRequestedAtIso = this.cancelRequestedAt
          ? new Date(this.cancelRequestedAt).toISOString()
          : null;
        const traceUrl = buildTraceUrl(item.id) ?? finalState.traceUrl ?? null;
        const stepsDone = preferNonEmptyArray(finalState.steps, current?.steps).filter(
          (s) => s.status === 'done',
        ).length;
        const fileEdits = preferNonEmptyArray(finalState.fileEdits, current?.fileEdits);
        const toolCalls = preferNonEmptyArray(
          finalState.toolCallHistory,
          current?.toolCallHistory,
        );
        const completedActions = stepsDone + fileEdits.length + toolCalls.length;
        const hasCompletedActions = completedActions > 0;
        const runResult: RunResult = {
          runId: item.id,
          phase: 'error',
          steps: preferNonEmptyArray(finalState.steps, current?.steps),
          fileEdits,
          toolCallHistory: toolCalls,
          tokenUsage: finalState.tokenUsage ?? current?.tokenUsage ?? null,
          traceUrl,
          messages: ensureRunMessages(
            item.instruction,
            finalState.messages ?? current?.messages,
          ),
          error: 'Run cancelled by user',
          verificationResult:
            finalState.verificationResult ?? current?.verificationResult ?? null,
          reviewFeedback:
            finalState.reviewFeedback ?? current?.reviewFeedback ?? null,
          durationMs: totalDuration,
          requestedUiMode: current?.requestedUiMode ?? item.requestedUiMode ?? null,
          threadKind,
          runMode: item.runMode ?? 'auto',
          executionPath: 'graph',
          queuedAt: queuedAtIso,
          startedAt: startedAtIso,
          modelOverride: item.modelOverride ?? null,
          modelFamily: item.modelFamily ?? null,
          modelOverrides: item.modelOverrides ?? null,
          resolvedModels,
          loopDiagnostics:
            finalState.loopDiagnostics ??
            latestLoopDiagnostics ??
            current?.loopDiagnostics ??
            null,
          completionStatus: hasCompletedActions
            ? 'cancelled_with_completed_actions'
            : 'cancelled',
          cancellation: {
            reason: 'Run cancelled by user',
            completed_actions: completedActions,
            tool_calls: toolCalls.length,
            edited_files: fileEdits.length,
            source: cancelSource,
            requested_at: cancelRequestedAtIso,
          },
          savedAt: new Date().toISOString(),
        };
        runResult.messages = ensureAssistantReplyForLatestTurn(
          runResult.messages,
          runResult.phase,
          runResult.error,
        );
        runResult.nextActions = deriveNextActions(runResult);
        runResult.messages = appendNextActionsToAssistantMessage(
          runResult.messages,
          runResult.nextActions,
        );
        this.runs.set(item.id, runResult);
        this.persistRun(runResult);
        this.broadcast({
          ...finalState,
          runId: item.id,
          phase: 'error',
          error: 'Run cancelled by user',
          threadKind,
          completionStatus: runResult.completionStatus,
        } as Partial<ShipyardStateType> & { threadKind?: string; completionStatus?: string });
        this.resolveTraceUrlInBackground(item.id);
      } else {
        const traceUrl = buildTraceUrl(item.id) ?? finalState.traceUrl ?? null;
        const runResult: RunResult = {
          runId: item.id,
          phase: finalState.phase,
          steps: preferNonEmptyArray(finalState.steps, current?.steps),
          fileEdits: preferNonEmptyArray(finalState.fileEdits, current?.fileEdits),
          toolCallHistory: preferNonEmptyArray(
            finalState.toolCallHistory,
            current?.toolCallHistory,
          ),
          tokenUsage: finalState.tokenUsage ?? current?.tokenUsage ?? null,
          traceUrl: traceUrl ?? finalState.traceUrl,
          messages: ensureRunMessages(
            item.instruction,
            finalState.messages ?? current?.messages,
          ),
          error: finalState.error,
          verificationResult:
            finalState.verificationResult ?? current?.verificationResult ?? null,
          reviewFeedback:
            finalState.reviewFeedback ?? current?.reviewFeedback ?? null,
          durationMs: totalDuration,
          requestedUiMode: current?.requestedUiMode ?? item.requestedUiMode ?? null,
          threadKind,
          runMode: item.runMode ?? 'auto',
          executionPath: 'graph',
          queuedAt: queuedAtIso,
          startedAt: startedAtIso,
          modelOverride: item.modelOverride ?? null,
          modelFamily: item.modelFamily ?? null,
          modelOverrides: item.modelOverrides ?? null,
          resolvedModels,
          loopDiagnostics:
            finalState.loopDiagnostics ??
            latestLoopDiagnostics ??
            current?.loopDiagnostics ??
            null,
          completionStatus: finalState.phase === 'done' ? 'completed' : 'failed',
          cancellation: null,
          savedAt: new Date().toISOString(),
        };
        runResult.messages = ensureAssistantReplyForLatestTurn(
          runResult.messages,
          runResult.phase,
          runResult.error,
        );
        runResult.nextActions = deriveNextActions(runResult);
        runResult.messages = appendNextActionsToAssistantMessage(
          runResult.messages,
          runResult.nextActions,
        );

        this.runs.set(item.id, runResult);
        this.persistRun(runResult);
        this.broadcast({
          ...finalState,
          messages: runResult.messages,
          nextActions: runResult.nextActions,
          threadKind,
          completionStatus: runResult.completionStatus,
        } as Partial<ShipyardStateType> & { nextActions?: NextAction[]; threadKind?: string; completionStatus?: string });
        this.resolveTraceUrlInBackground(item.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const recursionLimitHit = isGraphRecursionLimitError(err);
      const watchdogAbort = /watchdog/i.test(msg);
      const aborted =
        this.cancelRequested ||
        (err instanceof Error &&
          (err.name === 'AbortError' ||
            /abort|cancel/i.test(msg)));
      const cancelSource = this.cancelRequested
        ? (this.cancelSource ?? 'unknown')
        : watchdogAbort
          ? 'watchdog'
          : aborted
            ? 'abort_error'
            : 'unknown';
      const cancelRequestedAtIso = this.cancelRequestedAt
        ? new Date(this.cancelRequestedAt).toISOString()
        : (aborted || watchdogAbort ? new Date().toISOString() : null);
      const prev = this.runs.get(item.id);
      const diagnosticsBase =
        latestLoopDiagnostics ??
        finalState?.loopDiagnostics ??
        prev?.loopDiagnostics ??
        null;
      const recursionDiagnostics = recursionLimitHit
        ? withHardRecursionStop(diagnosticsBase, recursionLimit)
        : null;
      const effectiveDiagnostics = recursionDiagnostics ?? diagnosticsBase;
      const errorMsg = aborted
        ? 'Run cancelled by user'
        : recursionDiagnostics
          ? formatLoopStopError(recursionDiagnostics)
          : msg;
      const threadKindErr = this.resolveThreadKind(
        item,
        finalState ??
          ({
            runId: item.id,
            instruction: item.instruction,
            phase: 'error',
            steps: prev?.steps ?? [],
            fileEdits: prev?.fileEdits ?? [],
          } as ShipyardStateType),
      );

      const runResult: RunResult = {
        runId: item.id,
        phase: 'error',
        steps: prev?.steps ?? [],
        fileEdits: prev?.fileEdits ?? [],
        toolCallHistory: prev?.toolCallHistory ?? [],
        tokenUsage: prev?.tokenUsage ?? null,
        traceUrl: prev?.traceUrl ?? buildTraceUrl(item.id) ?? null,
        messages: ensureRunMessages(item.instruction, prev?.messages),
        verificationResult: prev?.verificationResult ?? null,
        reviewFeedback: prev?.reviewFeedback ?? null,
        error: errorMsg,
        durationMs: priorDuration + (Date.now() - startedAt),
        requestedUiMode: prev?.requestedUiMode ?? item.requestedUiMode ?? null,
        threadKind: threadKindErr,
        runMode: item.runMode ?? 'auto',
        executionPath: 'graph',
        queuedAt: queuedAtIso,
        startedAt: startedAtIso,
        modelOverride: item.modelOverride ?? null,
        modelFamily: item.modelFamily ?? null,
        modelOverrides: item.modelOverrides ?? null,
        resolvedModels,
        loopDiagnostics: effectiveDiagnostics,
        completionStatus: aborted
          ? ((prev?.toolCallHistory?.length ?? 0) + (prev?.fileEdits?.length ?? 0) > 0
            ? 'cancelled_with_completed_actions'
            : 'cancelled')
          : 'failed',
        cancellation: (aborted || watchdogAbort)
          ? {
              reason: aborted ? 'Run cancelled by user' : msg,
              completed_actions:
                (prev?.toolCallHistory?.length ?? 0) +
                (prev?.fileEdits?.length ?? 0),
              tool_calls: prev?.toolCallHistory?.length ?? 0,
              edited_files: prev?.fileEdits?.length ?? 0,
              source: cancelSource,
              requested_at: cancelRequestedAtIso,
            }
          : null,
        savedAt: new Date().toISOString(),
      };
      runResult.messages = ensureAssistantReplyForLatestTurn(
        runResult.messages,
        runResult.phase,
        runResult.error,
      );
      runResult.nextActions = deriveNextActions(runResult);
      runResult.messages = appendNextActionsToAssistantMessage(
        runResult.messages,
        runResult.nextActions,
      );
      this.runs.set(item.id, runResult);
      this.persistRun(runResult);
      this.broadcast({
        phase: 'error',
        error: errorMsg,
        runId: item.id,
        verificationResult: runResult.verificationResult,
        reviewFeedback: runResult.reviewFeedback,
        loopDiagnostics: runResult.loopDiagnostics ?? null,
      });
      this.resolveTraceUrlInBackground(item.id);
    } finally {
      clearRunBaseline(item.id);
      clearLiveFollowups(item.id);
      setLiveFeedListener(null);
      unsubProgress();
      setRunAbortSignal(null);
      this.pauseRequested = false;
      const pw = this.pauseResumeWaiters.splice(0);
      for (const r of pw) r();
      this.cancelRequested = false;
      this.cancelSource = 'unknown';
      this.cancelRequestedAt = null;
      this.processing = false;
      this.currentRunId = null;
      this.abortController = null;
      // Process next in queue
      void this.processNext();
    }
  }
}
