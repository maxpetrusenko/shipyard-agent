-- Add token_input / token_output columns that were in the 001 schema spec
-- but missing from older deployments that used a token_usage JSONB column.
-- Safe to run multiple times (IF NOT EXISTS guards).
ALTER TABLE shipyard_runs
  ADD COLUMN IF NOT EXISTS token_input  INTEGER,
  ADD COLUMN IF NOT EXISTS token_output INTEGER;
