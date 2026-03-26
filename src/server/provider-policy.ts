/**
 * Provider fallback-prevention policy.
 *
 * Controls whether the system can silently fall back between providers
 * (e.g. Anthropic -> OpenAI) or must fail loudly when a required
 * provider is missing.
 *
 * Env vars:
 *   SHIPYARD_ALLOW_PROVIDER_FALLBACK  — "true" (default) or "false"
 *   SHIPYARD_NO_FALLBACK_SOURCES      — comma-separated run sources where
 *                                        fallback is disabled (e.g. "webhook,invoke")
 *   SHIPYARD_REQUIRED_PROVIDERS       — comma-separated providers that must
 *                                        all be available (e.g. "anthropic,openai")
 */

import {
  checkSingleProvider,
  getRequiredProvidersFromEnv,
  parseProviderNames,
  type ProviderName,
} from './provider-readiness.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderPolicy {
  /** Whether silent fallback between providers is allowed. */
  allowFallback: boolean;
  /** Providers that must be available for this policy to pass. */
  requiredProviders: ProviderName[];
  /** The run source this policy was resolved for (informational). */
  source?: string;
}

export interface PolicyViolation {
  provider: ProviderName;
  remediation: string;
}

export class ProviderPolicyError extends Error {
  public readonly violations: PolicyViolation[];
  public readonly policy: ProviderPolicy;

  constructor(message: string, violations: PolicyViolation[], policy: ProviderPolicy) {
    super(message);
    this.name = 'ProviderPolicyError';
    this.violations = violations;
    this.policy = policy;
  }
}

// ---------------------------------------------------------------------------
// Env parsing helpers
// ---------------------------------------------------------------------------

function envBool(key: string, fallback: boolean): boolean {
  const raw = (process.env[key] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function envList(key: string): string[] {
  const raw = (process.env[key] ?? '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Policy resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the provider policy for a given run source.
 *
 * Logic:
 * 1. Global fallback flag: SHIPYARD_ALLOW_PROVIDER_FALLBACK (default true)
 * 2. Per-source no-fallback: SHIPYARD_NO_FALLBACK_SOURCES overrides global
 * 3. Required providers come from SHIPYARD_REQUIRED_PROVIDERS env var
 */
export function getProviderPolicy(runSource?: string): ProviderPolicy {
  const globalAllow = envBool('SHIPYARD_ALLOW_PROVIDER_FALLBACK', true);
  const noFallbackSources = envList('SHIPYARD_NO_FALLBACK_SOURCES');
  const requiredProviders = getRequiredProvidersFromEnv();

  const normalizedSource = (runSource ?? '').trim().toLowerCase();

  // If source is in the no-fallback list, disable fallback regardless of global
  let allowFallback = globalAllow;
  if (normalizedSource && noFallbackSources.includes(normalizedSource)) {
    allowFallback = false;
  }

  return {
    allowFallback,
    requiredProviders,
    source: runSource,
  };
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether the provider policy is satisfied.
 * Throws ProviderPolicyError if any required provider is unavailable
 * and fallback is not allowed.
 */
export function enforceProviderPolicy(policy: ProviderPolicy): void {
  if (policy.requiredProviders.length === 0) return;

  // When fallback is allowed and there are no required providers, skip check
  // When fallback is allowed but providers are required, still enforce them
  const violations: PolicyViolation[] = [];

  for (const name of policy.requiredProviders) {
    const status = checkSingleProvider(name);
    if (!status.available) {
      violations.push({
        provider: name,
        remediation: status.remediation ?? `Configure ${name} credentials`,
      });
    }
  }

  if (violations.length === 0) return;

  // If fallback is allowed and at least one LLM provider (anthropic/openai) is available,
  // only warn but do not throw
  if (policy.allowFallback) {
    const hasAnyLlm = (['anthropic', 'openai'] as ProviderName[]).some((p) => {
      const s = checkSingleProvider(p);
      return s.available;
    });
    if (hasAnyLlm) return;
  }

  const names = violations.map((v) => v.provider).join(', ');
  const hints = violations.map((v) => v.remediation).join('; ');
  throw new ProviderPolicyError(
    `Required provider(s) not available: ${names}. ${hints}. Set SHIPYARD_ALLOW_PROVIDER_FALLBACK=true or configure the missing provider(s).`,
    violations,
    policy,
  );
}
