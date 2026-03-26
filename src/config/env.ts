/**
 * Environment configuration.
 */

import { ensureEnvLoaded } from './bootstrap-env.js';

export interface ShipyardEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  OPENAI_API_KEY?: string;
  SHIPYARD_PORT: number;
  SHIPYARD_DB_URL: string;
  LANGCHAIN_TRACING_V2: boolean;
  LANGCHAIN_API_KEY?: string;
  LANGCHAIN_PROJECT?: string;
  SHIPYARD_WORK_DIR: string;
  SHIPYARD_API_KEY?: string;
}

export function loadEnv(): ShipyardEnv {
  ensureEnvLoaded();

  return {
    ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY']?.trim() || undefined,
    ANTHROPIC_AUTH_TOKEN: process.env['ANTHROPIC_AUTH_TOKEN']?.trim() || undefined,
    OPENAI_API_KEY: process.env['OPENAI_API_KEY']?.trim() || undefined,
    SHIPYARD_PORT: parseInt(process.env['SHIPYARD_PORT'] ?? '4200', 10),
    SHIPYARD_DB_URL:
      process.env['SHIPYARD_DB_URL'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://localhost/ship_shipshape_test',
    LANGCHAIN_TRACING_V2: process.env['LANGCHAIN_TRACING_V2'] === 'true',
    LANGCHAIN_API_KEY: process.env['LANGCHAIN_API_KEY'],
    LANGCHAIN_PROJECT: process.env['LANGCHAIN_PROJECT'] ?? 'shipyard',
    SHIPYARD_WORK_DIR: process.env['SHIPYARD_WORK_DIR'] ?? process.cwd(),
    SHIPYARD_API_KEY: process.env['SHIPYARD_API_KEY'],
  };
}
