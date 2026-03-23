/**
 * Instruction loop: queue + dispatch for the Shipyard graph.
 *
 * Processes one instruction at a time (sequential for MVP).
 * Instructions arrive via REST or WebSocket.
 *
 * Persistence:
 *   - File-based (always-on): every completed run is saved to results/<runId>.json
 *   - Postgres (optional): set via setPool() for relational storage
 *   - On init: loads existing runs from results/ so history survives restarts
 */

import { v4 as uuid } from 'uuid';
import { createShipyardGraph } from '../graph/builder.js';
import { ContextStore } from '../context/store.js';
import { buildTraceUrl, resolveLangSmithRunUrl } from './langsmith.js';
import {
  createRun as persistRunPg,
  saveRunToFile,
  loadRunsFromFiles,
  loadRunFromFile,
} from './persistence.js';
import type { Pool } from 'pg';
import type { ShipyardStateType, ContextEntry } from '../graph/state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueuedInstruction {
  id: string;
  instruction: string;
  contexts: ContextEntry[];
  createdAt: number;
}

export interface RunResult {
  runId: string;
  phase: ShipyardStateType['phase'];
  steps: ShipyardStateType['steps'];
  fileEdits: ShipyardStateType['fileEdits'];
  tokenUsage: ShipyardStateType['tokenUsage'];
  traceUrl: ShipyardStateType['traceUrl'];
  messages: ShipyardStateType['messages'];
  error: ShipyardStateType['error'];
  durationMs: number;
}

export type StateListener = (state: Partial<ShipyardStateType>) => void;

// ---------------------------------------------------------------------------
// Instruction loop
// ---------------------------------------------------------------------------

export class InstructionLoop {
  private queue: QueuedInstruction[] = [];
  private processing = false;
  private currentRunId: string | null = null;
  private abortController: AbortController | null = null;
  private contextStore = new ContextStore();
  private runs: Map<string, RunResult> = new Map();
  private listeners: Set<StateListener> = new Set();
  private pool: Pool | null = null;
  private initialized = false;

  /** Set a pg Pool for optional run persistence. */
  setPool(pool: Pool): void {
    this.pool = pool;
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
  submit(instruction: string, contexts?: ContextEntry[]): string {
    this.init(); // ensure loaded before first run
    const id = uuid();
    this.queue.push({
      id,
      instruction,
      contexts: contexts ?? [],
      createdAt: Date.now(),
    });
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

    // Re-queue with the same ID
    this.queue.push({
      id: runId,
      instruction,
      contexts: [],
      createdAt: Date.now(),
    });
    void this.processNext();
    return runId;
  }

  /** Inject context mid-run. */
  injectContext(entry: ContextEntry): void {
    this.contextStore.add(entry);
  }

  /** Cancel current run. */
  cancel(): boolean {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.processing = false;
      return true;
    }
    return false;
  }

  /** Get run result by ID. */
  getRun(id: string): RunResult | undefined {
    this.init();
    return this.runs.get(id);
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

  /** Get current queue status. */
  getStatus(): {
    processing: boolean;
    currentRunId: string | null;
    queueLength: number;
  } {
    return {
      processing: this.processing,
      currentRunId: this.currentRunId,
      queueLength: this.queue.length,
    };
  }

  /**
   * Persist a run result to file (always) and Postgres (if pool set).
   * Never throws — logs errors and continues.
   */
  private persistRun(runResult: RunResult): void {
    // Always save to file
    try {
      const path = saveRunToFile(runResult);
      console.log(`[persistence] saved ${runResult.runId} -> ${path}`);
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

  /** Process next instruction in the queue. */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const item = this.queue.shift()!;
    this.currentRunId = item.id;
    this.abortController = new AbortController();

    // Add contexts from the instruction
    for (const ctx of item.contexts) {
      this.contextStore.add(ctx);
    }

    const startedAt = Date.now();

    // Store an in-progress placeholder so GET /api/runs/:id doesn't 404
    // while graph.invoke() is blocking.
    const inProgressRun: RunResult = {
      runId: item.id,
      phase: 'planning',
      steps: [],
      fileEdits: [],
      tokenUsage: null,
      traceUrl: null,
      messages: [],
      error: null,
      durationMs: 0,
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
        fileEdits: state.fileEdits ?? current.fileEdits,
        tokenUsage: state.tokenUsage ?? current.tokenUsage,
        error: state.error ?? current.error,
        durationMs: Date.now() - startedAt,
      });
    });

    try {
      const graph = createShipyardGraph();

      const initialState: Partial<ShipyardStateType> = {
        runId: item.id,
        traceId: uuid(),
        instruction: item.instruction,
        phase: 'planning',
        steps: [],
        currentStepIndex: 0,
        fileEdits: [],
        toolCallHistory: [],
        verificationResult: null,
        reviewDecision: null,
        reviewFeedback: null,
        contexts: this.contextStore.getAll(),
        messages: [],
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
      };

      this.broadcast(initialState);

      // Use stream() instead of invoke() so we get phase updates mid-execution.
      // Each yielded chunk is { [nodeName]: partialState }.
      let finalState: ShipyardStateType = initialState as ShipyardStateType;
      const stream = await graph.stream(initialState, {
        configurable: { thread_id: item.id },
        streamMode: 'updates',
        runId: item.id,
        runName: `shipyard-${item.id.slice(0, 8)}`,
        tags: ['shipyard'],
      });

      for await (const chunk of stream) {
        // chunk is Record<string, Partial<ShipyardStateType>>
        const nodeUpdates = Object.values(
          chunk as Record<string, Partial<ShipyardStateType>>,
        );
        for (const update of nodeUpdates) {
          finalState = { ...finalState, ...update };
          this.broadcast(update);
        }
      }
      // Try public share link first, fall back to private URL
      const traceUrl =
        await resolveLangSmithRunUrl(item.id).catch(() => null) ??
        buildTraceUrl(item.id);
      const runResult: RunResult = {
        runId: item.id,
        phase: finalState.phase,
        steps: finalState.steps,
        fileEdits: finalState.fileEdits,
        tokenUsage: finalState.tokenUsage,
        traceUrl: traceUrl ?? finalState.traceUrl,
        messages: finalState.messages,
        error: finalState.error,
        durationMs: Date.now() - startedAt,
      };

      this.runs.set(item.id, runResult);
      this.persistRun(runResult);
      this.broadcast(finalState);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const runResult: RunResult = {
        runId: item.id,
        phase: 'error',
        steps: [],
        fileEdits: [],
        tokenUsage: null,
        traceUrl: null,
        messages: [],
        error: errorMsg,
        durationMs: Date.now() - startedAt,
      };
      this.runs.set(item.id, runResult);
      this.persistRun(runResult);
      this.broadcast({ phase: 'error', error: errorMsg });
    } finally {
      unsubProgress();
      this.processing = false;
      this.currentRunId = null;
      this.abortController = null;
      // Process next in queue
      void this.processNext();
    }
  }
}
