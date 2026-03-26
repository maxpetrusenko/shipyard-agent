/**
 * Audit log for privileged operations (retry-batch, admin actions, etc.).
 *
 * Storage:
 *   1. In-memory ring buffer (last 500 entries, configurable)
 *   2. Append-only JSONL file at results/audit.jsonl
 *
 * Every privileged operation should call `auditLog(entry)` with relevant
 * context so ops teams can trace who did what and when.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  /** ISO-8601 timestamp (auto-set if omitted). */
  timestamp: string;
  /** Action name, e.g. 'retry-batch', 'cancel-run', 'delete-run'. */
  action: string;
  /** Caller IP address. */
  callerIp: string;
  /** Token scope used by the caller (e.g. 'admin', 'full', 'invoke'). */
  callerScope: string;
  /** Number of events/items affected (e.g. retry batch size). */
  eventCount?: number;
  /** Whether the call was a dry run. */
  dryRun?: boolean;
  /** Short summary of the result (e.g. 'ok', 'partial', 'error: ...'). */
  resultSummary?: string;
  /** Extra context (free-form). */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_FILE_PATH = join(process.cwd(), 'results', 'audit.jsonl');
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ROTATIONS = 5;

// ---------------------------------------------------------------------------
// Ring buffer + file writer
// ---------------------------------------------------------------------------

let entries: AuditEntry[] = [];
let maxEntries = parseInt(
  process.env['SHIPYARD_AUDIT_LOG_MAX'] ?? '',
  10,
) || DEFAULT_MAX_ENTRIES;

let filePath: string | null =
  process.env['SHIPYARD_AUDIT_LOG_FILE'] ?? DEFAULT_FILE_PATH;

/** Override config (useful in tests). */
export function configureAuditLog(opts: {
  maxEntries?: number;
  filePath?: string | null;
}): void {
  if (opts.maxEntries != null) maxEntries = opts.maxEntries;
  if (opts.filePath !== undefined) filePath = opts.filePath;
}

/** Reset state (for tests). */
export function resetAuditLog(): void {
  entries = [];
  maxEntries = DEFAULT_MAX_ENTRIES;
  filePath = DEFAULT_FILE_PATH;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an audit log entry.
 *
 * Auto-fills `timestamp` if not provided. Appends to the in-memory ring
 * buffer and to the JSONL file on disk.
 */
export function auditLog(entry: Omit<AuditEntry, 'timestamp'> & { timestamp?: string }): void {
  const full: AuditEntry = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };

  // Ring buffer — newest first
  entries.unshift(full);
  while (entries.length > maxEntries) {
    entries.pop();
  }

  // Append to JSONL file (best-effort)
  appendToFile(full);
}

/**
 * Retrieve recent audit log entries (newest first).
 * @param limit Max entries to return (default: all in buffer).
 */
export function getAuditLog(limit?: number): AuditEntry[] {
  if (limit != null && limit > 0) {
    return entries.slice(0, limit);
  }
  return [...entries];
}

export function getAuditLogStats(): {
  entries: number;
  sizeBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const newestEntry = entries[0]?.timestamp ?? null;
  const oldestEntry = entries.length > 0 ? entries[entries.length - 1]?.timestamp ?? null : null;
  let sizeBytes = 0;
  if (filePath && existsSync(filePath)) {
    try {
      sizeBytes = statSync(filePath).size;
    } catch {
      sizeBytes = 0;
    }
  }
  return { entries: entries.length, sizeBytes, oldestEntry, newestEntry };
}

// ---------------------------------------------------------------------------
// File persistence
// ---------------------------------------------------------------------------

function appendToFile(entry: AuditEntry): void {
  if (!filePath) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath);
    appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Best-effort persistence — never crash the server for audit I/O
  }
}

function rotateIfNeeded(path: string): void {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size <= MAX_FILE_SIZE_BYTES) return;

  const oldest = `${path}.${MAX_ROTATIONS}`;
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = `${path}.${i}`;
    const to = `${path}.${i + 1}`;
    if (existsSync(from)) renameSync(from, to);
  }
  renameSync(path, `${path}.1`);
}
