/**
 * Lightweight operational metrics singleton.
 *
 * Tracks monotonic counters (e.g. events stored, retries) and provides
 * a JSON-serializable snapshot for the /metrics endpoint.
 * Also supports idempotency key replay tracking.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  payload: unknown;
  createdAt: number;
}

export interface MetricEntry {
  value: number;
  description?: string;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  count: number;
  avg: number;
}

/** Standard timing metric names. */
export type TimingName =
  | 'webhook_handle_ms'
  | 'retry_batch_ms'
  | 'event_persist_ms'
  | (string & {});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Fixed-size ring buffer for timing samples. */
export class RingBuffer {
  private buf: Float64Array;
  private head = 0;
  private _count = 0;

  constructor(private capacity: number) {
    if (capacity <= 0) {
      throw new Error('RingBuffer capacity must be > 0');
    }
    this.buf = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }

  get count(): number {
    return this._count;
  }

  /** Return a sorted copy of all stored values. */
  sorted(): number[] {
    const slice = Array.from(this.buf.subarray(0, this._count));
    slice.sort((a, b) => a - b);
    return slice;
  }

  /** Sum of all stored values. */
  sum(): number {
    let s = 0;
    for (let i = 0; i < this._count; i++) s += this.buf[i] ?? 0;
    return s;
  }

  reset(): void {
    this.head = 0;
    this._count = 0;
  }
}

const RING_CAPACITY = 1000;

class Ops {
  private counters = new Map<string, number>();
  private descriptions = new Map<string, string>();
  private idempotencyStore = new Map<string, IdempotencyRecord>();
  private timings = new Map<string, RingBuffer>();
  private idempotencyCleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.idempotencyCleanupTimer = setInterval(() => {
      this.evictExpiredIdempotency();
    }, 5 * 60_000);
    if (typeof (this.idempotencyCleanupTimer as any).unref === 'function') {
      (this.idempotencyCleanupTimer as any).unref();
    }
  }

  /** Increment a counter by 1 (or `amount`). */
  increment(key: string, amount = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  /** Set a description for a metric key (shown in /metrics). */
  describe(key: string, desc: string): void {
    this.descriptions.set(key, desc);
  }

  /** Return current counters as a plain object with descriptions. */
  snapshot(): Record<string, MetricEntry> {
    const out: Record<string, MetricEntry> = {};
    for (const [key, value] of this.counters) {
      out[key] = { value, description: this.descriptions.get(key) };
    }
    return out;
  }

  /** SHA-256 hash of a body string (for idempotency). */
  bodyHash(body: string): string {
    return createHash('sha256').update(body).digest('hex');
  }

  /** Store an idempotency record (TTL: 24h). */
  setIdempotency(key: string, record: IdempotencyRecord): void {
    this.idempotencyStore.set(key, record);
  }

  /** Get an idempotency record if it exists and is not expired. */
  getIdempotency(key: string): IdempotencyRecord | null {
    const record = this.idempotencyStore.get(key);
    if (!record) return null;
    // 24h TTL
    if (Date.now() - record.createdAt > 86_400_000) {
      this.idempotencyStore.delete(key);
      return null;
    }
    return record;
  }

  /** Evict expired idempotency records and emit metric when removals occur. */
  evictExpiredIdempotency(now = Date.now()): number {
    let removed = 0;
    for (const [key, record] of this.idempotencyStore.entries()) {
      if (now - record.createdAt > 86_400_000) {
        this.idempotencyStore.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.increment('shipyard.idempotency.evicted', removed);
    return removed;
  }

  // -------------------------------------------------------------------------
  // Timing percentiles
  // -------------------------------------------------------------------------

  /** Record a timing sample (ring buffer, last RING_CAPACITY entries). */
  recordTiming(name: TimingName, durationMs: number): void {
    let ring = this.timings.get(name);
    if (!ring) {
      ring = new RingBuffer(RING_CAPACITY);
      this.timings.set(name, ring);
    }
    ring.push(durationMs);
  }

  /** Compute p50/p95/p99/count/avg for a named timing metric. */
  getPercentiles(name: string): PercentileStats | null {
    const ring = this.timings.get(name);
    if (!ring || ring.count === 0) return null;
    const sorted = ring.sorted();
    const n = sorted.length;
    return {
      p50: sorted[Math.floor(n * 0.5)] ?? 0,
      p95: sorted[Math.floor(n * 0.95)] ?? 0,
      p99: sorted[Math.min(Math.floor(n * 0.99), n - 1)] ?? 0,
      count: n,
      avg: Math.round((ring.sum() / n) * 100) / 100,
    };
  }

  /** Snapshot of all timing metrics. */
  timingsSnapshot(): Record<string, PercentileStats> {
    const out: Record<string, PercentileStats> = {};
    for (const [name] of this.timings) {
      const stats = this.getPercentiles(name);
      if (stats) out[name] = stats;
    }
    return out;
  }

  /** Clear all state (for testing). */
  reset(): void {
    this.counters.clear();
    this.descriptions.clear();
    this.idempotencyStore.clear();
    this.timings.clear();
  }
}

export const OPS = new Ops();

// Pre-register metric descriptions
OPS.describe('shipyard.events.stored', 'Total invoke/webhook events stored');
OPS.describe('shipyard.events.retried', 'Total event retries attempted');
OPS.describe('shipyard.invoke.accepted', 'Invoke requests accepted');
OPS.describe('shipyard.invoke.rejected', 'Invoke requests rejected (auth, validation)');
OPS.describe('shipyard.webhook.accepted', 'Webhook deliveries accepted');
OPS.describe('shipyard.webhook.rejected', 'Webhook deliveries rejected');
OPS.describe('shipyard.webhook.dedupe_hit', 'Webhook deliveries skipped (duplicate)');
OPS.describe('shipyard.dead_letter.added', 'Entries added to dead-letter queue');
OPS.describe('shipyard.memory.pressure_elevated', 'Memory pressure elevated transitions');
OPS.describe('shipyard.memory.pressure_critical', 'Memory pressure critical transitions');
OPS.describe('shipyard.llm.cache_read_tokens', 'Total Anthropic cache-read input tokens');
OPS.describe('shipyard.llm.cache_write_tokens', 'Total Anthropic cache-creation input tokens');
OPS.describe('shipyard.llm.compaction.anthropic_applied', 'Anthropic message compaction applications');
OPS.describe('shipyard.llm.compaction.openai_applied', 'OpenAI message compaction applications');
OPS.describe('shipyard.llm.compaction.messages_dropped', 'Total messages dropped by compaction');
OPS.describe('shipyard.llm.compaction.chars_saved', 'Approximate characters removed by compaction');
OPS.describe('shipyard.idempotency.evicted', 'Expired idempotency records evicted by periodic cleanup');
OPS.describe('shipyard.persistence.pg_reconnect_attempts', 'Postgres persistence reconnect verification attempts');
OPS.describe('shipyard.persistence.pg_reconnect_giveup', 'Postgres persistence reconnect gave up after retries');
OPS.describe('shipyard.security.unprotected_invoke', 'Invoke-auth checks where SHIPYARD_INVOKE_TOKEN was not configured');
