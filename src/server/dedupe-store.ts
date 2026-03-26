/**
 * Disk-backed webhook delivery deduplication store.
 *
 * Survives process restarts by persisting entries to
 * `results/webhook-dedupe-cache.json` using atomic write (temp + rename).
 * TTL-based expiry prevents unbounded growth. Debounced persist avoids
 * hammering disk on every webhook.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export interface DedupeEntry {
  eventId: string;
  deliveryId: string;
  eventType: string;
  receivedAt: string; // ISO timestamp
  ttlMs: number;
}

export interface DedupeStoreOptions {
  /** Default TTL per entry in milliseconds. Default: 86400000 (24h). */
  ttlMs?: number;
  /** Maximum entries before oldest are evicted. Default: 10000. */
  maxEntries?: number;
  /** Path to the JSON cache file. Null disables disk persistence. */
  filePath?: string | null;
  /** Debounce interval for disk writes in milliseconds. Default: 5000. */
  persistDebounceMs?: number;
}

const DEFAULT_TTL_MS = 86_400_000; // 24 hours
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_PERSIST_DEBOUNCE_MS = 5_000;
const DEFAULT_FILE_PATH = join(process.cwd(), 'results', 'webhook-dedupe-cache.json');

export class DedupeStore {
  private readonly entries = new Map<string, DedupeEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly filePath: string | null;
  private readonly persistDebounceMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: DedupeStoreOptions) {
    this.ttlMs = options?.ttlMs ?? (parseInt(
      process.env['SHIPYARD_GITHUB_WEBHOOK_DEDUPE_TTL_MS'] ?? '',
      10,
    ) || DEFAULT_TTL_MS);

    this.maxEntries = options?.maxEntries ?? (parseInt(
      process.env['SHIPYARD_WEBHOOK_DEDUPE_MAX_ENTRIES'] ?? '',
      10,
    ) || DEFAULT_MAX_ENTRIES);

    this.filePath = options?.filePath !== undefined
      ? options.filePath
      : (process.env['SHIPYARD_WEBHOOK_DEDUPE_FILE'] ?? DEFAULT_FILE_PATH);

    this.persistDebounceMs = options?.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
  }

  /** Check if a dedupe key exists and is not expired. */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /** Get the entry for a key if it exists and is not expired. */
  get(key: string): DedupeEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  /** Store a dedupe entry and schedule a debounced persist. */
  set(key: string, entry: DedupeEntry): void {
    this.entries.set(key, entry);
    this.enforceMaxEntries();
    this.schedulePersist();
  }

  /** Remove a specific key. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Number of live (non-expired) entries. */
  get size(): number {
    return this.entries.size;
  }

  /** Remove all entries past their TTL. */
  evict(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (this.isExpiredAt(entry, now)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Load cache from disk, filtering out expired entries. */
  loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, DedupeEntry>;
      const now = Date.now();
      for (const [key, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.eventId !== 'string') continue;
        if (typeof entry.receivedAt !== 'string') continue;
        if (this.isExpiredAt(entry, now)) continue;
        this.entries.set(key, entry);
      }
      this.enforceMaxEntries();
    } catch {
      // Best-effort cache warmup only
    }
  }

  /** Atomic write: temp file + rename. */
  persistToDisk(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const serializable = Object.fromEntries(this.entries.entries());
      const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tempPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf-8');
      renameSync(tempPath, this.filePath);
    } catch {
      // Best-effort persistence only
    }
  }

  /** Flush any pending debounced persist immediately. */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistToDisk();
  }

  /** Cancel pending persist timer (for clean shutdown). */
  destroy(): void {
    this.flush();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // -- Internal ---------------------------------------------------------------

  private isExpired(entry: DedupeEntry): boolean {
    return this.isExpiredAt(entry, Date.now());
  }

  private isExpiredAt(entry: DedupeEntry, now: number): boolean {
    const ttl = entry.ttlMs > 0 ? entry.ttlMs : this.ttlMs;
    const receivedMs = new Date(entry.receivedAt).getTime();
    if (Number.isNaN(receivedMs)) return true;
    return now - receivedMs > ttl;
  }

  private enforceMaxEntries(): void {
    if (this.entries.size <= this.maxEntries) return;
    // Evict oldest first
    const sorted = [...this.entries.entries()]
      .sort((a, b) => {
        const aMs = new Date(a[1].receivedAt).getTime();
        const bMs = new Date(b[1].receivedAt).getTime();
        return aMs - bMs;
      });
    const overflow = this.entries.size - this.maxEntries;
    for (let i = 0; i < overflow; i++) {
      this.entries.delete(sorted[i]![0]);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return; // already scheduled
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistToDisk();
    }, this.persistDebounceMs);
  }
}
