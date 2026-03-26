/**
 * Dead-letter queue for malformed/unsupported webhook payloads.
 *
 * Stores rejected webhooks with enough context to diagnose failures
 * and replay valid-but-unprocessed payloads. Disk-backed via atomic
 * write (temp + rename) to `results/dead-letter.json`.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeadLetterReasonCode =
  | 'signature_invalid'
  | 'parse_error'
  | 'unsupported_event'
  | 'missing_fields'
  | 'command_parse_error'
  | 'unknown';

export interface DeadLetterEntry {
  id: string;
  receivedAt: string;
  reason: string;
  reasonCode: DeadLetterReasonCode;
  webhookDeliveryId?: string;
  webhookEventType?: string;
  payload?: unknown;
  headers?: Record<string, string>;
  replayable: boolean;
}

export interface DeadLetterQueueOptions {
  maxEntries?: number;
  filePath?: string | null;
}

// ---------------------------------------------------------------------------
// Header sanitization
// ---------------------------------------------------------------------------

const SENSITIVE_HEADER_PATTERNS = [
  'authorization',
  'x-hub-signature',
  'x-hub-signature-256',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
];

export function sanitizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADER_PATTERNS.some((pattern) => lower.includes(pattern))) continue;
    if (typeof value === 'string') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.join(', ');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DeadLetterQueue
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_FILE_PATH = join(process.cwd(), 'results', 'dead-letter.json');

export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];
  private readonly byId = new Map<string, DeadLetterEntry>();
  private readonly maxEntries: number;
  private readonly filePath: string | null;

  constructor(options?: DeadLetterQueueOptions) {
    this.maxEntries = options?.maxEntries ?? (parseInt(
      process.env['SHIPYARD_DEAD_LETTER_MAX'] ?? '',
      10,
    ) || DEFAULT_MAX_ENTRIES);

    this.filePath = options?.filePath !== undefined
      ? options.filePath
      : (process.env['SHIPYARD_DEAD_LETTER_FILE'] ?? DEFAULT_FILE_PATH);
  }

  /** Add a dead-letter entry. Evicts oldest when at capacity. */
  add(params: Omit<DeadLetterEntry, 'id' | 'receivedAt'>): DeadLetterEntry {
    const entry: DeadLetterEntry = {
      ...params,
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
    };
    this.entries.unshift(entry);
    this.byId.set(entry.id, entry);
    this.enforceMax();
    this.saveToDisk();
    return entry;
  }

  /** List entries, newest first. Optional limit (default: all). */
  list(limit?: number): DeadLetterEntry[] {
    if (limit != null && limit > 0) {
      return this.entries.slice(0, limit);
    }
    return [...this.entries];
  }

  /** Get a single entry by id. */
  get(id: string): DeadLetterEntry | undefined {
    return this.byId.get(id);
  }

  /** Remove all entries. */
  clear(): void {
    this.entries = [];
    this.byId.clear();
    this.saveToDisk();
  }

  /** Current queue depth. */
  size(): number {
    return this.entries.length;
  }

  /** Remove a single entry by id. Returns true if found. */
  remove(id: string): boolean {
    const entry = this.byId.get(id);
    if (!entry) return false;
    this.byId.delete(id);
    const idx = this.entries.indexOf(entry);
    if (idx !== -1) this.entries.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  /** Persist to disk using atomic temp + rename. */
  saveToDisk(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(
        tempPath,
        `${JSON.stringify(this.entries, null, 2)}\n`,
        'utf-8',
      );
      renameSync(tempPath, this.filePath);
    } catch {
      // Best-effort persistence only
    }
  }

  /** Load from disk, merging into current entries (deduped by id). */
  loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as DeadLetterEntry;
        if (typeof entry.id !== 'string') continue;
        if (typeof entry.receivedAt !== 'string') continue;
        if (typeof entry.reasonCode !== 'string') continue;
        if (this.byId.has(entry.id)) continue;
        this.entries.push(entry);
        this.byId.set(entry.id, entry);
      }
      // Sort newest-first
      this.entries.sort(
        (a, b) => b.receivedAt.localeCompare(a.receivedAt),
      );
      this.enforceMax();
    } catch {
      // Best-effort cache warmup only
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private enforceMax(): void {
    while (this.entries.length > this.maxEntries) {
      const oldest = this.entries.pop();
      if (oldest) this.byId.delete(oldest.id);
    }
  }
}
