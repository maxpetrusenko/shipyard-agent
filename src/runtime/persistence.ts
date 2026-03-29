/**
 * Shipyard persistence layer.
 *
 * Two backends:
 *   1. JSON file-based (default in normal runtime) — writes to results/<runId>.json
 *   2. Postgres (optional, set via setPool) — full relational storage
 *
 * File-based persistence is the default for app/runtime usage and is disabled
 * during vitest runs (or via SHIPYARD_DISABLE_FILE_PERSISTENCE=true) so tests
 * do not pollute real dashboard history.
 * Postgres is an additive enhancement when a pool is provided.
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
import type { RunResult } from './loop.js';
import type { ContextEntry, LLMMessage } from '../graph/state.js';

/** Ensures columns expected by createRun exist (older DBs may predate migration 002). */
let pgSchemaReady: Promise<void> | null = null;

export function ensureShipyardPgSchema(pool: Pool): Promise<void> {
  if (!pgSchemaReady) {
    pgSchemaReady = (async () => {
      await pool.query(`
        ALTER TABLE shipyard_runs
          ADD COLUMN IF NOT EXISTS token_input INTEGER,
          ADD COLUMN IF NOT EXISTS token_output INTEGER,
          ADD COLUMN IF NOT EXISTS campaign_id TEXT,
          ADD COLUMN IF NOT EXISTS root_run_id TEXT,
          ADD COLUMN IF NOT EXISTS parent_run_id TEXT,
          ADD COLUMN IF NOT EXISTS project_context JSONB;
      `);
    })().catch((e) => {
      pgSchemaReady = null;
      throw e;
    });
  }
  return pgSchemaReady;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default results directory (project root / results) */
const DEFAULT_RESULTS_DIR = join(
  new URL('../../', import.meta.url).pathname,
  'results',
);

function getResultsDir(): string {
  const override = process.env['SHIPYARD_RESULTS_DIR']?.trim();
  return override || DEFAULT_RESULTS_DIR;
}

function isFilePersistenceEnabled(): boolean {
  return process.env['SHIPYARD_DISABLE_FILE_PERSISTENCE'] !== 'true' &&
    !process.env['VITEST'];
}

function latestUserMessageContent(messages: RunResult['messages'] | undefined): string {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg?.role === 'user' && msg.content.trim()) return msg.content.trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// File-based persistence (default-on outside tests)
// ---------------------------------------------------------------------------

/** Ensure the results directory exists. */
function ensureResultsDir(dir: string = getResultsDir()): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Serialize a RunResult to a JSON-safe object (strips undefined, handles dates). */
function serializeRun(result: RunResult): Record<string, unknown> {
  return {
    runId: result.runId,
    campaignId: result.campaignId ?? null,
    rootRunId: result.rootRunId ?? null,
    parentRunId: result.parentRunId ?? null,
    instruction: result.instruction ?? latestUserMessageContent(result.messages),
    phase: result.phase,
    steps: result.steps,
    fileEdits: result.fileEdits,
    toolCallHistory: result.toolCallHistory,
    tokenUsage: result.tokenUsage ?? null,
    traceUrl: result.traceUrl ?? null,
    messages: result.messages,
    error: result.error ?? null,
    verificationResult: result.verificationResult ?? null,
    reviewFeedback: result.reviewFeedback ?? null,
    durationMs: result.durationMs,
    peakRssKb: result.peakRssKb ?? null,
    requestedUiMode: result.requestedUiMode ?? null,
    threadKind: result.threadKind ?? null,
    runMode: result.runMode ?? null,
    executionPath: result.executionPath ?? null,
    queuedAt: result.queuedAt ?? null,
    startedAt: result.startedAt ?? null,
    modelOverride: result.modelOverride ?? null,
    modelFamily: result.modelFamily ?? null,
    modelOverrides: result.modelOverrides ?? null,
    resolvedModels: result.resolvedModels ?? null,
    projectContext: result.projectContext ?? null,
    completionStatus: result.completionStatus ?? null,
    cancellation: result.cancellation ?? null,
    loopDiagnostics: result.loopDiagnostics ?? null,
    executeDiagnostics: result.executeDiagnostics ?? null,
    errorClassification: result.errorClassification ?? null,
    nextActions: result.nextActions ?? [],
    savedAt: new Date().toISOString(),
  };
}

/**
 * Save a RunResult to a JSON file.
 * File name: results/<runId>.json
 * Always overwrites (upsert semantics).
 */
export function saveRunToFile(
  result: RunResult,
  dir: string = getResultsDir(),
): string | null {
  if (!isFilePersistenceEnabled()) return null;
  ensureResultsDir(dir);
  const filePath = join(dir, `${result.runId}.json`);
  // Atomic write: tmp file + rename prevents corruption if process crashes mid-write.
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(serializeRun(result), null, 2) + '\n');
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
  return filePath;
}

/** Remove `results/<runId>.json` if it exists. Returns whether a file was removed. */
export function deleteRunFromFile(
  runId: string,
  dir: string = getResultsDir(),
): boolean {
  if (!isFilePersistenceEnabled()) return false;
  const filePath = join(dir, `${runId}.json`);
  try {
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('[persistence] delete file failed:', err);
    return false;
  }
}

/**
 * Load a single RunResult from a JSON file.
 * Returns null if the file doesn't exist or is unparseable.
 */
export function loadRunFromFile(
  runId: string,
  dir: string = getResultsDir(),
): RunResult | null {
  if (!isFilePersistenceEnabled()) return null;
  const filePath = join(dir, `${runId}.json`);
  return parseRunFile(filePath);
}

/**
 * Load all RunResults from the results directory.
 * Skips files that don't parse as valid RunResults (e.g. bench results with different schema).
 */
export function loadRunsFromFiles(dir: string = getResultsDir()): RunResult[] {
  if (!isFilePersistenceEnabled()) return [];
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const runs: RunResult[] = [];

  for (const file of files) {
    const run = parseRunFile(join(dir, file));
    if (run) runs.push(run);
  }

  return runs;
}

/**
 * Parse a single JSON file into a RunResult.
 * Returns null if the file is missing, empty, or has an incompatible schema.
 */
function parseRunFile(filePath: string): RunResult | null {
  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return null;

    const data = JSON.parse(raw) as Record<string, unknown>;

    // Must have runId and phase to be a valid RunResult (skip bench results)
    if (typeof data['runId'] !== 'string' || typeof data['phase'] !== 'string') {
      return null;
    }

    return {
      runId: data['runId'] as string,
      campaignId:
        typeof data['campaignId'] === 'string' ? data['campaignId'] : null,
      rootRunId:
        typeof data['rootRunId'] === 'string' ? data['rootRunId'] : null,
      parentRunId:
        typeof data['parentRunId'] === 'string' ? data['parentRunId'] : null,
      instruction:
        typeof data['instruction'] === 'string'
          ? data['instruction']
          : latestUserMessageContent((data['messages'] as RunResult['messages']) ?? []),
      phase: data['phase'] as RunResult['phase'],
      steps: (data['steps'] as RunResult['steps']) ?? [],
      fileEdits: (data['fileEdits'] as RunResult['fileEdits']) ?? [],
      toolCallHistory: (data['toolCallHistory'] as RunResult['toolCallHistory']) ?? [],
      tokenUsage: (data['tokenUsage'] as RunResult['tokenUsage']) ?? null,
      traceUrl: (data['traceUrl'] as RunResult['traceUrl']) ?? null,
      messages: (data['messages'] as RunResult['messages']) ?? [],
      error: (data['error'] as RunResult['error']) ?? null,
      verificationResult:
        (data['verificationResult'] as RunResult['verificationResult']) ?? null,
      reviewFeedback:
        (data['reviewFeedback'] as RunResult['reviewFeedback']) ?? null,
      durationMs: typeof data['durationMs'] === 'number' ? data['durationMs'] : 0,
      peakRssKb: typeof data['peakRssKb'] === 'number' ? data['peakRssKb'] : null,
      requestedUiMode:
        data['requestedUiMode'] === 'ask' ||
        data['requestedUiMode'] === 'plan' ||
        data['requestedUiMode'] === 'agent'
          ? (data['requestedUiMode'] as RunResult['requestedUiMode'])
          : null,
      threadKind:
        data['threadKind'] === 'ask' ||
        data['threadKind'] === 'plan' ||
        data['threadKind'] === 'agent'
          ? (data['threadKind'] as RunResult['threadKind'])
          : undefined,
      runMode:
        data['runMode'] === 'auto' ||
        data['runMode'] === 'chat' ||
        data['runMode'] === 'code'
          ? (data['runMode'] as RunResult['runMode'])
          : undefined,
      executionPath:
        data['executionPath'] === 'graph' ||
        data['executionPath'] === 'local-shortcut'
          ? (data['executionPath'] as RunResult['executionPath'])
          : undefined,
      queuedAt: typeof data['queuedAt'] === 'string' ? data['queuedAt'] : undefined,
      startedAt: typeof data['startedAt'] === 'string' ? data['startedAt'] : undefined,
      modelOverride:
        typeof data['modelOverride'] === 'string'
          ? data['modelOverride']
          : null,
      modelFamily:
        data['modelFamily'] === 'anthropic' || data['modelFamily'] === 'openai'
          ? (data['modelFamily'] as RunResult['modelFamily'])
          : null,
      modelOverrides:
        data['modelOverrides'] &&
        typeof data['modelOverrides'] === 'object'
          ? (data['modelOverrides'] as RunResult['modelOverrides'])
          : null,
      resolvedModels:
        data['resolvedModels'] &&
        typeof data['resolvedModels'] === 'object'
          ? (data['resolvedModels'] as RunResult['resolvedModels'])
          : null,
      projectContext:
        data['projectContext'] &&
        typeof data['projectContext'] === 'object' &&
        !Array.isArray(data['projectContext'])
          ? (data['projectContext'] as RunResult['projectContext'])
          : null,
      completionStatus:
        data['completionStatus'] === 'completed' ||
        data['completionStatus'] === 'failed' ||
        data['completionStatus'] === 'cancelled' ||
        data['completionStatus'] === 'cancelled_with_completed_actions'
          ? (data['completionStatus'] as RunResult['completionStatus'])
          : undefined,
      cancellation:
        data['cancellation'] &&
        typeof data['cancellation'] === 'object'
          ? (data['cancellation'] as RunResult['cancellation'])
          : null,
      loopDiagnostics:
        data['loopDiagnostics'] &&
        typeof data['loopDiagnostics'] === 'object'
          ? (data['loopDiagnostics'] as RunResult['loopDiagnostics'])
          : null,
      executeDiagnostics:
        data['executeDiagnostics'] &&
        typeof data['executeDiagnostics'] === 'object'
          ? (data['executeDiagnostics'] as RunResult['executeDiagnostics'])
          : null,
      errorClassification:
        data['errorClassification'] === 'transient' ||
        data['errorClassification'] === 'scope' ||
        data['errorClassification'] === 'watchdog' ||
        data['errorClassification'] === 'recursion' ||
        data['errorClassification'] === 'abort' ||
        data['errorClassification'] === 'unknown'
          ? (data['errorClassification'] as RunResult['errorClassification'])
          : null,
      nextActions: Array.isArray(data['nextActions'])
        ? (data['nextActions'] as RunResult['nextActions'])
        : [],
      savedAt: typeof data['savedAt'] === 'string' ? data['savedAt'] : undefined,
    };
  } catch (err) {
    console.warn(`[persistence] skipping corrupt/unreadable file: ${filePath}`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Postgres persistence (optional)
// ---------------------------------------------------------------------------

/**
 * Upsert a RunResult into the shipyard_runs table.
 * Matches the 001-init.sql schema: token_input/token_output as separate cols.
 */
export async function createRun(
  pool: Pool,
  run: RunResult,
): Promise<void> {
  await ensureShipyardPgSchema(pool);
  const instruction =
    run.messages.find((m) => m.role === 'user')?.content ?? '';
  const status =
    run.phase === 'done' ? 'done' : run.phase === 'error' ? 'error' : 'running';

  await pool.query(
    `INSERT INTO shipyard_runs
       (id, instruction, phase, steps, file_edits, token_input, token_output, trace_url, error, duration_ms, campaign_id, root_run_id, parent_run_id, project_context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       instruction = EXCLUDED.instruction,
       phase       = EXCLUDED.phase,
       steps       = EXCLUDED.steps,
       file_edits  = EXCLUDED.file_edits,
       token_input = EXCLUDED.token_input,
       token_output= EXCLUDED.token_output,
       trace_url   = EXCLUDED.trace_url,
       error       = EXCLUDED.error,
       duration_ms = EXCLUDED.duration_ms,
       campaign_id = EXCLUDED.campaign_id,
       root_run_id = EXCLUDED.root_run_id,
       parent_run_id = EXCLUDED.parent_run_id,
       project_context = EXCLUDED.project_context`,
    [
      run.runId,
      instruction,
      status,
      JSON.stringify(run.steps),
      JSON.stringify(run.fileEdits),
      run.tokenUsage?.input ?? null,
      run.tokenUsage?.output ?? null,
      run.traceUrl ?? null,
      run.error ?? null,
      run.durationMs,
      run.campaignId ?? null,
      run.rootRunId ?? null,
      run.parentRunId ?? null,
      run.projectContext ? JSON.stringify(run.projectContext) : null,
    ],
  );
}

export async function getRun(
  pool: Pool,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(
    'SELECT * FROM shipyard_runs WHERE id = $1',
    [id],
  );
  return (rows[0] as Record<string, unknown>) ?? null;
}

export async function listRuns(
  pool: Pool,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    'SELECT * FROM shipyard_runs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return rows as Record<string, unknown>[];
}

/** Delete run row (cascades to shipyard_messages). Returns number of rows deleted. */
export async function deleteRunFromPg(
  pool: Pool,
  runId: string,
): Promise<number> {
  const r = await pool.query('DELETE FROM shipyard_runs WHERE id = $1', [runId]);
  return r.rowCount ?? 0;
}

/** Build a RunResult for listing when the run exists only in Postgres (not in memory / JSON files). */
export function pgRowToRunSummary(row: Record<string, unknown>): RunResult {
  const instruction = String(row['instruction'] ?? '');
  const ti = row['token_input'];
  const to = row['token_output'];
  const tokenUsage =
    ti != null && to != null
      ? { input: Number(ti), output: Number(to) }
      : null;
  const steps = parsePgJsonb(row['steps'], [] as RunResult['steps']);
  const fileEdits = parsePgJsonb(row['file_edits'], [] as RunResult['fileEdits']);
  const projectContext = parsePgJsonb(
    row['project_context'],
    null as RunResult['projectContext'],
  );
  const created = row['created_at'];
  const savedAt =
    created instanceof Date
      ? created.toISOString()
      : typeof created === 'string'
        ? created
        : undefined;
  return {
    runId: String(row['id'] ?? ''),
    campaignId: (row['campaign_id'] as string) ?? null,
    rootRunId: (row['root_run_id'] as string) ?? null,
    parentRunId: (row['parent_run_id'] as string) ?? null,
    instruction,
    phase: (row['phase'] as RunResult['phase']) ?? 'idle',
    steps,
    fileEdits,
    toolCallHistory: [],
    tokenUsage,
    traceUrl: (row['trace_url'] as string) ?? null,
    messages: [{ role: 'user', content: instruction }],
    error: (row['error'] as string) ?? null,
    verificationResult: null,
    reviewFeedback: null,
    durationMs: Number(row['duration_ms'] ?? 0),
    nextActions: [],
    projectContext,
    savedAt,
  };
}

function parsePgJsonb<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (Array.isArray(v)) return v as T;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Messages (Postgres only)
// ---------------------------------------------------------------------------

export async function appendMessage(
  pool: Pool,
  runId: string,
  message: LLMMessage,
  toolInfo?: { tool_name: string; tool_args: unknown; tool_result: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO shipyard_messages (run_id, role, content, tool_name, tool_args, tool_result)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      runId,
      message.role,
      message.content,
      toolInfo?.tool_name ?? null,
      toolInfo?.tool_args ? JSON.stringify(toolInfo.tool_args) : null,
      toolInfo?.tool_result ?? null,
    ],
  );
}

export async function getMessages(
  pool: Pool,
  runId: string,
): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    'SELECT * FROM shipyard_messages WHERE run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Contexts (Postgres only)
// ---------------------------------------------------------------------------

export async function upsertContext(
  pool: Pool,
  entry: ContextEntry & { active?: boolean },
): Promise<void> {
  await pool.query(
    `INSERT INTO shipyard_contexts (label, content, source, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (label) DO UPDATE SET
       content = EXCLUDED.content,
       source = EXCLUDED.source,
       active = EXCLUDED.active,
       updated_at = NOW()`,
    [entry.label, entry.content, entry.source, entry.active ?? true],
  );
}

export async function getActiveContexts(
  pool: Pool,
): Promise<ContextEntry[]> {
  const { rows } = await pool.query(
    'SELECT label, content, source FROM shipyard_contexts WHERE active = true ORDER BY label',
  );
  return rows as ContextEntry[];
}

export async function deactivateContext(
  pool: Pool,
  label: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE shipyard_contexts SET active = false, updated_at = NOW() WHERE label = $1',
    [label],
  );
  return (rowCount ?? 0) > 0;
}
