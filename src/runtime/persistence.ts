/**
 * Shipyard persistence layer: CRUD for runs, messages, contexts.
 *
 * Uses pg Pool (DI from server startup).
 */

import type { Pool } from 'pg';
import type { RunResult } from './loop.js';
import type { ContextEntry, LLMMessage } from '../graph/state.js';

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function createRun(
  pool: Pool,
  run: RunResult,
): Promise<void> {
  await pool.query(
    `INSERT INTO shipyard_runs (id, instruction, status, phase, steps, file_edits, token_usage, trace_url, error, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       phase = EXCLUDED.phase,
       steps = EXCLUDED.steps,
       file_edits = EXCLUDED.file_edits,
       token_usage = EXCLUDED.token_usage,
       trace_url = EXCLUDED.trace_url,
       error = EXCLUDED.error,
       duration_ms = EXCLUDED.duration_ms,
       updated_at = NOW()`,
    [
      run.runId,
      run.messages.find((m) => m.role === 'user')?.content ?? '',
      run.phase === 'done' ? 'done' : run.phase === 'error' ? 'error' : 'running',
      run.phase,
      JSON.stringify(run.steps),
      JSON.stringify(run.fileEdits),
      run.tokenUsage ? JSON.stringify(run.tokenUsage) : null,
      run.traceUrl,
      run.error,
      run.durationMs,
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

// ---------------------------------------------------------------------------
// Messages
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
// Contexts
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
