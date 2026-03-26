/**
 * Event persistence layer for invoke/webhook events.
 *
 * Dual-backend (mirroring src/runtime/persistence.ts):
 *   1. JSON file-based (default-on outside tests) — writes to results/events/<id>.json
 *   2. Postgres (optional) — shipyard_invoke_events table
 *
 * File persistence is always-on fallback.
 * Postgres is additive when a pool is provided.
 * Neither backend throws — errors are logged and swallowed.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { OPS } from './ops.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvokeEventStatus = 'accepted' | 'rejected' | 'ignored';

export interface PersistedInvokeEvent {
  id: string;
  source: string;
  eventType: string;
  status: InvokeEventStatus;
  reason?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EVENTS_DIR = join(
  new URL('../../', import.meta.url).pathname,
  'results',
  'events',
);

function getEventsDir(): string {
  const override = process.env['SHIPYARD_EVENTS_DIR']?.trim();
  return override || DEFAULT_EVENTS_DIR;
}

function isFilePersistenceEnabled(): boolean {
  return (
    process.env['SHIPYARD_DISABLE_FILE_PERSISTENCE'] !== 'true' &&
    !process.env['VITEST']
  );
}

// ---------------------------------------------------------------------------
// In-memory index types
// ---------------------------------------------------------------------------

/** In-memory index: sorted list of events (newest first) with fast id lookup. */
export interface EventIndex {
  /** Events sorted by receivedAt descending. */
  events: PersistedInvokeEvent[];
  /** Fast lookup: event id -> true. Used for deduplication. */
  dedupeSet: Set<string>;
}

// ---------------------------------------------------------------------------
// Retention defaults
// ---------------------------------------------------------------------------

const DEFAULT_RETENTION_HOURS = 168; // 7 days
const DEFAULT_MAX_COUNT = 10_000;
const DEFAULT_RETENTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw != null ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// EventPersistence class
// ---------------------------------------------------------------------------

export class EventPersistence {
  private pool: Pool | null = null;
  private eventsDir: string;
  private pgTableVerified = false;
  private pgTableMissing = false;
  private pgReconnectAttempts = 0;
  private pgReconnectGiveupEmitted = false;
  private pgNextVerifyAt = 0;
  private forceFileEnabled: boolean;
  private recentWriteFailures: boolean[] = [];
  private lastError: string | null = null;
  private lastWriteAt: string | null = null;

  /** In-memory index rebuilt by hydrate(). */
  private index: EventIndex = { events: [], dedupeSet: new Set() };

  /** Retention timer handle (null when not running). */
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(eventsDir?: string, opts?: { forceFileEnabled?: boolean }) {
    this.eventsDir = eventsDir ?? getEventsDir();
    this.forceFileEnabled = opts?.forceFileEnabled ?? false;
  }

  isHealthy(): boolean {
    const last3 = this.recentWriteFailures.slice(-3);
    return !(last3.length === 3 && last3.every((failed) => failed));
  }

  health() {
    return {
      healthy: this.isHealthy(),
      lastError: this.lastError,
      lastWriteAt: this.lastWriteAt,
    };
  }

  // -------------------------------------------------------------------------
  // In-memory index — hydrate / query
  // -------------------------------------------------------------------------

  /**
   * Read all persisted events from disk and rebuild in-memory indexes.
   * Safe to call multiple times (replaces previous state).
   * Handles empty/missing directories gracefully.
   */
  hydrate(): EventIndex {
    const events = this.loadEventsFromFiles();
    // Sort newest-first
    events.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    const dedupeSet = new Set<string>();
    for (const e of events) {
      dedupeSet.add(e.id);
    }

    this.index = { events, dedupeSet };
    return this.index;
  }

  /** Return a shallow copy of the current in-memory index. */
  getIndex(): EventIndex {
    return this.index;
  }

  /** Check if an event id already exists (deduplication). */
  hasEvent(id: string): boolean {
    return this.index.dedupeSet.has(id);
  }

  // -------------------------------------------------------------------------
  // Retention
  // -------------------------------------------------------------------------

  /**
   * Run both age-based and count-based retention policies.
   *
   * 1. Age: delete events older than `retentionHours` (env SHIPYARD_EVENT_RETENTION_HOURS, default 168).
   * 2. Count: keep only the newest `maxCount` events (env SHIPYARD_EVENT_MAX_COUNT, default 10 000).
   *
   * Operates on in-memory index AND deletes corresponding files.
   * Returns number of events purged.
   */
  runRetention(opts?: {
    retentionHours?: number;
    maxCount?: number;
  }): number {
    const retentionHours =
      opts?.retentionHours ??
      parseIntEnv('SHIPYARD_EVENT_RETENTION_HOURS', DEFAULT_RETENTION_HOURS);
    const maxCount =
      opts?.maxCount ??
      parseIntEnv('SHIPYARD_EVENT_MAX_COUNT', DEFAULT_MAX_COUNT);

    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
    const before = this.index.events.length;

    // --- Age-based: remove events older than cutoff ---
    const kept: PersistedInvokeEvent[] = [];
    const removedIds: string[] = [];

    for (const evt of this.index.events) {
      if (evt.receivedAt < cutoff) {
        removedIds.push(evt.id);
      } else {
        kept.push(evt);
      }
    }

    // --- Count-based: if still over maxCount, trim oldest (tail of sorted array) ---
    if (kept.length > maxCount) {
      const overflow = kept.splice(maxCount);
      for (const evt of overflow) {
        removedIds.push(evt.id);
      }
    }

    // Delete files for purged events
    for (const id of removedIds) {
      this.deleteEventFile(id);
      this.index.dedupeSet.delete(id);
    }

    this.index.events = kept;
    return before - kept.length;
  }

  /**
   * Start a recurring retention timer.
   * @param intervalMs  How often to run retention (default: 1 hour).
   */
  startRetentionTimer(intervalMs: number = DEFAULT_RETENTION_INTERVAL_MS): void {
    this.stopRetentionTimer();
    this.retentionTimer = setInterval(() => {
      try {
        this.runRetention();
      } catch (err) {
        console.warn('[event-persistence] retention tick failed:', err);
      }
    }, intervalMs);
    // Allow Node to exit even if this timer is pending
    if (this.retentionTimer && typeof (this.retentionTimer as any).unref === 'function') {
      (this.retentionTimer as any).unref();
    }
  }

  /** Stop the recurring retention timer. */
  stopRetentionTimer(): void {
    if (this.retentionTimer !== null) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  /** Delete a single event file by id. Best-effort; never throws. */
  private deleteEventFile(id: string): void {
    try {
      const filePath = join(this.eventsDir, `${id}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err) {
      console.warn(`[event-persistence] failed to delete event file ${id}:`, err);
    }
  }

  private isFileEnabled(): boolean {
    return this.forceFileEnabled || isFilePersistenceEnabled();
  }

  /** Wire a Postgres pool (same pattern as loop.setPool). */
  setPool(pool: Pool): void {
    this.pool = pool;
    this.pgTableVerified = false;
    this.pgTableMissing = false;
    this.pgReconnectAttempts = 0;
    this.pgReconnectGiveupEmitted = false;
    this.pgNextVerifyAt = 0;
  }

  // -------------------------------------------------------------------------
  // File persistence (always-on fallback)
  // -------------------------------------------------------------------------

  /** Ensure the events directory exists. */
  private ensureEventsDir(dir: string = this.eventsDir): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** Atomic write to results/events/<id>.json */
  saveEventToFile(
    event: PersistedInvokeEvent,
    dir: string = this.eventsDir,
  ): string | null {
    if (!this.isFileEnabled()) return null;
    try {
      this.ensureEventsDir(dir);
      const filePath = join(dir, `${event.id}.json`);
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      const payload = JSON.stringify(event, null, 2) + '\n';
      writeFileSync(tempPath, payload);
      renameSync(tempPath, filePath);
      this.noteFileWrite(true);
      return filePath;
    } catch (err) {
      console.warn('[event-persistence] file save failed:', err);
      this.noteFileWrite(false, err);
      return null;
    }
  }

  /** Load all events from results/events/*.json */
  loadEventsFromFiles(dir: string = this.eventsDir): PersistedInvokeEvent[] {
    if (!this.isFileEnabled()) return [];
    if (!existsSync(dir)) return [];
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      const events: PersistedInvokeEvent[] = [];
      for (const file of files) {
        const parsed = this.parseEventFile(join(dir, file));
        if (parsed) events.push(parsed);
      }
      return events;
    } catch (err) {
      console.warn('[event-persistence] loadEventsFromFiles failed:', err);
      return [];
    }
  }

  /** Parse a single event JSON file. */
  private parseEventFile(filePath: string): PersistedInvokeEvent | null {
    try {
      const raw = readFileSync(filePath, 'utf-8').trim();
      if (!raw) return null;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data['id'] !== 'string' || typeof data['source'] !== 'string') {
        return null;
      }
      return {
        id: data['id'] as string,
        source: data['source'] as string,
        eventType: String(data['eventType'] ?? 'unknown'),
        status: normalizeStatus(data['status']),
        reason: typeof data['reason'] === 'string' ? data['reason'] : undefined,
        runId: typeof data['runId'] === 'string' ? data['runId'] : undefined,
        metadata:
          data['metadata'] && typeof data['metadata'] === 'object'
            ? (data['metadata'] as Record<string, unknown>)
            : undefined,
        receivedAt:
          typeof data['receivedAt'] === 'string'
            ? data['receivedAt']
            : new Date().toISOString(),
      };
    } catch {
      console.warn(`[event-persistence] parse failed for ${filePath}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Postgres persistence (optional)
  // -------------------------------------------------------------------------

  /** Quick check that the table exists. Only logs once if missing. */
  private async verifyPgTable(): Promise<boolean> {
    if (this.pgTableVerified) return true;
    if (!this.pool) return false;
    const now = Date.now();
    if (this.pgTableMissing && now < this.pgNextVerifyAt) return false;
    if (this.pgReconnectAttempts >= 5) {
      if (!this.pgReconnectGiveupEmitted) {
        OPS.increment('shipyard.persistence.pg_reconnect_giveup');
        this.pgReconnectGiveupEmitted = true;
      }
      return false;
    }
    try {
      await this.pool.query(
        `SELECT 1 FROM shipyard_invoke_events LIMIT 0`,
      );
      this.pgTableVerified = true;
      this.pgTableMissing = false;
      this.pgReconnectAttempts = 0;
      this.pgReconnectGiveupEmitted = false;
      this.pgNextVerifyAt = 0;
      return true;
    } catch {
      this.pgTableMissing = true;
      this.pgReconnectAttempts += 1;
      this.pgNextVerifyAt = now + 60_000;
      OPS.increment('shipyard.persistence.pg_reconnect_attempts');
      if (this.pgReconnectAttempts === 1) {
        console.warn(
          '[event-persistence] shipyard_invoke_events table not found; Postgres event persistence retry enabled.',
        );
      }
      if (this.pgReconnectAttempts >= 5 && !this.pgReconnectGiveupEmitted) {
        OPS.increment('shipyard.persistence.pg_reconnect_giveup');
        this.pgReconnectGiveupEmitted = true;
      }
      return false;
    }
  }

  /** Upsert a single event into Postgres. */
  async upsertEventPg(event: PersistedInvokeEvent): Promise<void> {
    if (!this.pool) return;
    const ok = await this.verifyPgTable();
    if (!ok) return;
    await this.pool.query(
      `INSERT INTO shipyard_invoke_events
         (id, source, event_type, status, reason, run_id, metadata, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         source     = EXCLUDED.source,
         event_type = EXCLUDED.event_type,
         status     = EXCLUDED.status,
         reason     = EXCLUDED.reason,
         run_id     = EXCLUDED.run_id,
         metadata   = EXCLUDED.metadata,
         received_at = EXCLUDED.received_at`,
      [
        event.id,
        event.source,
        event.eventType,
        event.status,
        event.reason ?? null,
        event.runId ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.receivedAt,
      ],
    );
  }

  /** List events from Postgres with optional filters. */
  async listEventsPg(opts: {
    limit?: number;
    source?: string;
    status?: string;
  } = {}): Promise<PersistedInvokeEvent[]> {
    if (!this.pool) return [];
    const ok = await this.verifyPgTable();
    if (!ok) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (opts.source) {
      conditions.push(`source = $${idx++}`);
      params.push(opts.source);
    }
    if (opts.status) {
      conditions.push(`status = $${idx++}`);
      params.push(opts.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    params.push(limit);

    const { rows } = await this.pool.query(
      `SELECT * FROM shipyard_invoke_events ${where} ORDER BY received_at DESC LIMIT $${idx}`,
      params,
    );
    return (rows as Record<string, unknown>[]).map(pgRowToEvent);
  }

  /** Get a single event by id from Postgres. */
  async getEventPg(id: string): Promise<PersistedInvokeEvent | null> {
    if (!this.pool) return null;
    const ok = await this.verifyPgTable();
    if (!ok) return null;
    const { rows } = await this.pool.query(
      `SELECT * FROM shipyard_invoke_events WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return pgRowToEvent(rows[0] as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // Unified API
  // -------------------------------------------------------------------------

  /**
   * Persist event to both backends. Never throws.
   * File write is synchronous; Postgres is fire-and-forget.
   */
  persistEvent(event: PersistedInvokeEvent): void {
    // File persistence (sync, never throws)
    try {
      this.saveEventToFile(event);
    } catch (err) {
      console.warn('[event-persistence] file persist failed:', err);
      this.noteFileWrite(false, err);
    }

    // Postgres persistence (async, fire-and-forget)
    if (this.pool) {
      this.upsertEventPg(event).catch((err) => {
        console.warn('[event-persistence] pg persist failed:', err);
      });
    }
  }

  /**
   * Load events from the best available source.
   * Prefers Postgres when available; falls back to file.
   */
  async loadEvents(opts: {
    limit?: number;
    source?: string;
    status?: string;
  } = {}): Promise<PersistedInvokeEvent[]> {
    // Try Postgres first
    if (this.pool) {
      try {
        const pgEvents = await this.listEventsPg(opts);
        if (pgEvents.length > 0) return pgEvents;
      } catch (err) {
        console.warn('[event-persistence] pg load failed, falling back to file:', err);
      }
    }

    // File fallback (no filter support — load all, apply in-memory)
    let events = this.loadEventsFromFiles();
    if (opts.source) {
      events = events.filter((e) => e.source === opts.source);
    }
    if (opts.status) {
      events = events.filter((e) => e.status === opts.status);
    }
    // Sort newest first
    events.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const limit = opts.limit ?? 100;
    return events.slice(0, limit);
  }

  private noteFileWrite(success: boolean, err?: unknown): void {
    this.recentWriteFailures.push(!success);
    if (this.recentWriteFailures.length > 3) this.recentWriteFailures.shift();
    if (success) {
      this.lastWriteAt = new Date().toISOString();
      return;
    }
    this.lastError = err instanceof Error ? err.message : String(err ?? 'Unknown file write error');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeStatus(raw: unknown): InvokeEventStatus {
  if (raw === 'accepted' || raw === 'rejected' || raw === 'ignored') {
    return raw;
  }
  return 'ignored';
}

function pgRowToEvent(row: Record<string, unknown>): PersistedInvokeEvent {
  let metadata: Record<string, unknown> | undefined;
  const rawMeta = row['metadata'];
  if (rawMeta && typeof rawMeta === 'object') {
    metadata = rawMeta as Record<string, unknown>;
  } else if (typeof rawMeta === 'string') {
    try {
      metadata = JSON.parse(rawMeta) as Record<string, unknown>;
    } catch {
      metadata = undefined;
    }
  }

  const receivedAtRaw = row['received_at'];
  const receivedAt =
    receivedAtRaw instanceof Date
      ? receivedAtRaw.toISOString()
      : typeof receivedAtRaw === 'string'
        ? receivedAtRaw
        : new Date().toISOString();

  return {
    id: String(row['id'] ?? ''),
    source: String(row['source'] ?? ''),
    eventType: String(row['event_type'] ?? 'unknown'),
    status: normalizeStatus(row['status']),
    reason: typeof row['reason'] === 'string' ? row['reason'] : undefined,
    runId: typeof row['run_id'] === 'string' ? row['run_id'] : undefined,
    metadata,
    receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Singleton for route-level usage
// ---------------------------------------------------------------------------

export const eventPersistence = new EventPersistence();
