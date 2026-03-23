/**
 * Instruction loop: queue + dispatch for the Shipyard graph.
 *
 * Processes one instruction at a time (sequential for MVP).
 * Instructions arrive via REST or WebSocket.
 */

import { v4 as uuid } from 'uuid';
import { createShipyardGraph } from '../graph/builder.js';
import { ContextStore } from '../context/store.js';
import { buildTraceUrl } from './langsmith.js';
import { createRun as persistRun } from './persistence.js';
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

  /** Set a pg Pool for optional run persistence. */
  setPool(pool: Pool): void {
    this.pool = pool;
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
    return Array.from(this.runs.values());
  }

  /** Get paginated run results. */
  getRunsPaginated(limit: number, offset: number): RunResult[] {
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

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: item.id },
      });

      const finalState = result as ShipyardStateType;
      const traceUrl = buildTraceUrl(item.id);
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
      if (this.pool) {
        await persistRun(this.pool, runResult).catch((e) =>
          console.error('[persistence] failed to save run:', e),
        );
      }
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
      if (this.pool) {
        await persistRun(this.pool, runResult).catch((e) =>
          console.error('[persistence] failed to save error run:', e),
        );
      }
      this.broadcast({ phase: 'error', error: errorMsg });
    } finally {
      this.processing = false;
      this.currentRunId = null;
      this.abortController = null;
      // Process next in queue
      void this.processNext();
    }
  }
}
