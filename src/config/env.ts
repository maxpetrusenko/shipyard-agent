/**
 * Environment configuration.
 */

import { execSync } from 'node:child_process';

export interface ShipyardEnv {
  ANTHROPIC_API_KEY: string;
  SHIPYARD_PORT: number;
  SHIPYARD_DB_URL: string;
  LANGCHAIN_TRACING_V2: boolean;
  LANGCHAIN_API_KEY?: string;
  LANGCHAIN_PROJECT?: string;
  SHIPYARD_WORK_DIR: string;
  SHIPYARD_API_KEY?: string;
}

export function loadEnv(): ShipyardEnv {
  const key = process.env['ANTHROPIC_API_KEY'];
  const authToken = process.env['ANTHROPIC_AUTH_TOKEN'];
  if (!key && !authToken) {
    // Check macOS Keychain as fallback (handled by client.ts)
    try {
      const raw = execSync(
        "security find-generic-password -s 'Claude Code-credentials' -w",
        { encoding: 'utf-8', timeout: 5000 },
      ).trim();
      const parsed = JSON.parse(raw);
      if (!parsed?.claudeAiOauth?.accessToken) {
        throw new Error('No access token in Keychain');
      }
    } catch {
      throw new Error(
        'No Anthropic credentials found. Set ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or log in with Claude Code.',
      );
    }
  }

  return {
    ANTHROPIC_API_KEY: key ?? 'oauth',
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
