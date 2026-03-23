-- Shipyard persistence schema
-- Apply: psql $SHIPYARD_DB_URL < scripts/migrations/001-init.sql
--
-- Tables:
--   shipyard_runs      - completed run results
--   shipyard_messages  - conversation messages per run
--   shipyard_contexts  - injected context entries (global, not per-run)

CREATE TABLE IF NOT EXISTS shipyard_runs (
  id            TEXT PRIMARY KEY,
  instruction   TEXT NOT NULL,
  phase         TEXT NOT NULL,
  steps         JSONB NOT NULL DEFAULT '[]',
  file_edits    JSONB NOT NULL DEFAULT '[]',
  token_input   INTEGER,
  token_output  INTEGER,
  estimated_cost NUMERIC(10,4),
  trace_url     TEXT,
  error         TEXT,
  duration_ms   INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipyard_messages (
  id          SERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES shipyard_runs(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  tool_name   TEXT,
  tool_args   JSONB,
  tool_result TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_run ON shipyard_messages(run_id);

CREATE TABLE IF NOT EXISTS shipyard_contexts (
  label      TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('user', 'tool', 'system')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
