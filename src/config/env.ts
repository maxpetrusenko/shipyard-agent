/**
 * Environment configuration.
 */

export interface ShipyardEnv {
  ANTHROPIC_API_KEY: string;
  SHIPYARD_PORT: number;
  SHIPYARD_DB_URL: string;
  LANGCHAIN_TRACING_V2: boolean;
  LANGCHAIN_API_KEY?: string;
  LANGCHAIN_PROJECT?: string;
  SHIPYARD_WORK_DIR: string;
}

export function loadEnv(): ShipyardEnv {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }

  return {
    ANTHROPIC_API_KEY: key,
    SHIPYARD_PORT: parseInt(process.env['SHIPYARD_PORT'] ?? '4200', 10),
    SHIPYARD_DB_URL:
      process.env['SHIPYARD_DB_URL'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://localhost/ship_shipshape_test',
    LANGCHAIN_TRACING_V2: process.env['LANGCHAIN_TRACING_V2'] === 'true',
    LANGCHAIN_API_KEY: process.env['LANGCHAIN_API_KEY'],
    LANGCHAIN_PROJECT: process.env['LANGCHAIN_PROJECT'] ?? 'shipyard',
    SHIPYARD_WORK_DIR: process.env['SHIPYARD_WORK_DIR'] ?? process.cwd(),
  };
}
