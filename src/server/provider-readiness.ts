/**
 * Provider readiness checks for LLM and CLI providers.
 *
 * Inspects env vars, Keychain (via client.ts logic), and CLI availability
 * to produce a structured readiness report with remediation hints.
 */

import { getCodexCliStatus } from './codex-cli-status.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderName = 'anthropic' | 'openai' | 'codex';
export type AuthMethod = 'api_key' | 'oauth_env' | 'keychain' | 'none';

export interface ProviderStatus {
  provider: ProviderName;
  available: boolean;
  authMethod: AuthMethod;
  detail: string;
  remediation?: string;
}

export interface ReadinessReport {
  ready: boolean;
  providers: ProviderStatus[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Individual provider checks
// ---------------------------------------------------------------------------

function checkAnthropic(): ProviderStatus {
  const apiKey = process.env['ANTHROPIC_API_KEY']?.trim();
  const authToken = process.env['ANTHROPIC_AUTH_TOKEN']?.trim();

  // Mode 1: standard API key (non-placeholder)
  if (apiKey && apiKey !== 'dummy' && apiKey !== 'oauth') {
    return {
      provider: 'anthropic',
      available: true,
      authMethod: 'api_key',
      detail: `API key configured (${apiKey.slice(0, 8)}...)`,
    };
  }

  // Mode 2: OAuth token from env (Claude Code Max plan)
  if (authToken) {
    return {
      provider: 'anthropic',
      available: true,
      authMethod: 'oauth_env',
      detail: 'OAuth token configured (Claude Max compatible)',
    };
  }

  // Not available
  return {
    provider: 'anthropic',
    available: false,
    authMethod: 'none',
    detail: 'No Anthropic credentials found',
    remediation:
      'Set ANTHROPIC_API_KEY in .env, or run `claude login` for OAuth and set ANTHROPIC_AUTH_TOKEN',
  };
}

function checkOpenAI(): ProviderStatus {
  const apiKey = process.env['OPENAI_API_KEY']?.trim();

  if (apiKey) {
    return {
      provider: 'openai',
      available: true,
      authMethod: 'api_key',
      detail: `API key configured (${apiKey.slice(0, 8)}...)`,
    };
  }

  return {
    provider: 'openai',
    available: false,
    authMethod: 'none',
    detail: 'No OpenAI API key found',
    remediation: 'Set OPENAI_API_KEY in .env',
  };
}

function checkCodex(): ProviderStatus {
  const codex = getCodexCliStatus();

  if (!codex.codexCliInstalled) {
    return {
      provider: 'codex',
      available: false,
      authMethod: 'none',
      detail: 'Codex CLI not installed',
      remediation: 'Install Codex CLI: npm i -g @openai/codex, then run `codex auth`',
    };
  }

  if (!codex.codexCliAuthenticated) {
    return {
      provider: 'codex',
      available: false,
      authMethod: 'none',
      detail: `Codex CLI installed but not authenticated (auth: ${codex.codexAuthPath})`,
      remediation: 'Run `codex auth` to connect your plan',
    };
  }

  return {
    provider: 'codex',
    available: true,
    authMethod: 'api_key',
    detail: `Codex CLI installed and authenticated (auth: ${codex.codexAuthPath})`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_CHECKERS: Record<ProviderName, () => ProviderStatus> = {
  anthropic: checkAnthropic,
  openai: checkOpenAI,
  codex: checkCodex,
};

/** Parse a comma-separated provider list from env or query param. */
export function parseProviderNames(raw: string | undefined): ProviderName[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => s === 'anthropic' || s === 'openai' || s === 'codex');
}

/** Read SHIPYARD_REQUIRED_PROVIDERS from env (cached per call). */
export function getRequiredProvidersFromEnv(): ProviderName[] {
  return parseProviderNames(process.env['SHIPYARD_REQUIRED_PROVIDERS']);
}

/** Check a single provider by name. */
export function checkSingleProvider(name: ProviderName): ProviderStatus {
  const checker = PROVIDER_CHECKERS[name];
  return checker();
}

// ---------------------------------------------------------------------------
// Main readiness check (lenient — at least one LLM provider)
// ---------------------------------------------------------------------------

export async function checkProviderReadiness(): Promise<ReadinessReport> {
  const anthropic = checkAnthropic();
  const openai = checkOpenAI();
  const codex = checkCodex();

  const providers = [anthropic, openai, codex];

  // Ready if at least one LLM provider (anthropic or openai) is available
  const ready = anthropic.available || openai.available;

  return {
    ready,
    providers,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Strict readiness check — ALL specified providers must be available
// ---------------------------------------------------------------------------

export interface StrictReadinessReport extends ReadinessReport {
  strict: true;
  requiredProviders: ProviderName[];
  missingProviders: ProviderName[];
}

export async function checkProviderReadinessStrict(
  requiredProviders: ProviderName[],
): Promise<StrictReadinessReport> {
  const allStatuses = [checkAnthropic(), checkOpenAI(), checkCodex()];
  const statusByName = new Map(allStatuses.map((s) => [s.provider, s]));

  const missingProviders: ProviderName[] = [];
  for (const name of requiredProviders) {
    const status = statusByName.get(name);
    if (!status || !status.available) {
      missingProviders.push(name);
    }
  }

  return {
    strict: true,
    ready: missingProviders.length === 0,
    requiredProviders,
    missingProviders,
    providers: allStatuses,
    timestamp: new Date().toISOString(),
  };
}
