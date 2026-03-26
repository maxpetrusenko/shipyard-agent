/**
 * Tests for provider policy enforcement and strict readiness.
 *
 * Covers Task #29 (strict readiness) and Task #30 (fallback prevention).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getProviderPolicy,
  enforceProviderPolicy,
  ProviderPolicyError,
} from '../../src/server/provider-policy.js';
import {
  checkProviderReadiness,
  checkProviderReadinessStrict,
  parseProviderNames,
  getRequiredProvidersFromEnv,
} from '../../src/server/provider-readiness.js';

// ---------------------------------------------------------------------------
// Env snapshot helpers
// ---------------------------------------------------------------------------

const envSnapshot: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]): void {
  for (const key of keys) {
    envSnapshot[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const [key, val] of Object.entries(envSnapshot)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// parseProviderNames
// ---------------------------------------------------------------------------

describe('parseProviderNames', () => {
  it('parses comma-separated provider names', () => {
    expect(parseProviderNames('anthropic,openai')).toEqual(['anthropic', 'openai']);
  });

  it('ignores invalid provider names', () => {
    expect(parseProviderNames('anthropic,invalid,openai')).toEqual(['anthropic', 'openai']);
  });

  it('handles whitespace', () => {
    expect(parseProviderNames(' anthropic , openai ')).toEqual(['anthropic', 'openai']);
  });

  it('returns empty for undefined', () => {
    expect(parseProviderNames(undefined)).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(parseProviderNames('')).toEqual([]);
  });

  it('includes codex as valid provider', () => {
    expect(parseProviderNames('codex')).toEqual(['codex']);
  });
});

// ---------------------------------------------------------------------------
// getRequiredProvidersFromEnv
// ---------------------------------------------------------------------------

describe('getRequiredProvidersFromEnv', () => {
  beforeEach(() => {
    saveEnv('SHIPYARD_REQUIRED_PROVIDERS');
  });

  afterEach(restoreEnv);

  it('returns empty when env var is not set', () => {
    delete process.env['SHIPYARD_REQUIRED_PROVIDERS'];
    expect(getRequiredProvidersFromEnv()).toEqual([]);
  });

  it('returns parsed providers from env', () => {
    process.env['SHIPYARD_REQUIRED_PROVIDERS'] = 'anthropic,openai';
    expect(getRequiredProvidersFromEnv()).toEqual(['anthropic', 'openai']);
  });
});

// ---------------------------------------------------------------------------
// checkProviderReadiness (lenient)
// ---------------------------------------------------------------------------

describe('checkProviderReadiness (lenient)', () => {
  beforeEach(() => {
    saveEnv('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY');
  });

  afterEach(restoreEnv);

  it('reports ready when openai key is set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key-1234';
    const report = await checkProviderReadiness();
    expect(report.ready).toBe(true);
    const openai = report.providers.find((p) => p.provider === 'openai');
    expect(openai?.available).toBe(true);
  });

  it('reports not ready when no provider keys set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    const report = await checkProviderReadiness();
    expect(report.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkProviderReadinessStrict
// ---------------------------------------------------------------------------

describe('checkProviderReadinessStrict', () => {
  beforeEach(() => {
    saveEnv('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY');
  });

  afterEach(restoreEnv);

  it('reports ready when all required providers available', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key-1234';
    const report = await checkProviderReadinessStrict(['openai']);
    expect(report.strict).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.missingProviders).toEqual([]);
    expect(report.requiredProviders).toEqual(['openai']);
  });

  it('reports not ready when required provider missing', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key-1234';
    const report = await checkProviderReadinessStrict(['anthropic', 'openai']);
    expect(report.strict).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.missingProviders).toEqual(['anthropic']);
  });

  it('lists multiple missing providers', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    const report = await checkProviderReadinessStrict(['anthropic', 'openai']);
    expect(report.ready).toBe(false);
    expect(report.missingProviders).toContain('anthropic');
    expect(report.missingProviders).toContain('openai');
  });
});

// ---------------------------------------------------------------------------
// getProviderPolicy
// ---------------------------------------------------------------------------

describe('getProviderPolicy', () => {
  beforeEach(() => {
    saveEnv(
      'SHIPYARD_ALLOW_PROVIDER_FALLBACK',
      'SHIPYARD_NO_FALLBACK_SOURCES',
      'SHIPYARD_REQUIRED_PROVIDERS',
    );
  });

  afterEach(restoreEnv);

  it('returns default policy (fallback allowed, no required providers)', () => {
    delete process.env['SHIPYARD_ALLOW_PROVIDER_FALLBACK'];
    delete process.env['SHIPYARD_NO_FALLBACK_SOURCES'];
    delete process.env['SHIPYARD_REQUIRED_PROVIDERS'];
    const policy = getProviderPolicy();
    expect(policy.allowFallback).toBe(true);
    expect(policy.requiredProviders).toEqual([]);
  });

  it('respects global fallback=false', () => {
    process.env['SHIPYARD_ALLOW_PROVIDER_FALLBACK'] = 'false';
    delete process.env['SHIPYARD_NO_FALLBACK_SOURCES'];
    delete process.env['SHIPYARD_REQUIRED_PROVIDERS'];
    const policy = getProviderPolicy('api');
    expect(policy.allowFallback).toBe(false);
  });

  it('disables fallback for specific sources via NO_FALLBACK_SOURCES', () => {
    delete process.env['SHIPYARD_ALLOW_PROVIDER_FALLBACK'];
    process.env['SHIPYARD_NO_FALLBACK_SOURCES'] = 'webhook,invoke';
    delete process.env['SHIPYARD_REQUIRED_PROVIDERS'];

    const webhookPolicy = getProviderPolicy('webhook');
    expect(webhookPolicy.allowFallback).toBe(false);

    const apiPolicy = getProviderPolicy('api');
    expect(apiPolicy.allowFallback).toBe(true);
  });

  it('includes required providers from env', () => {
    delete process.env['SHIPYARD_ALLOW_PROVIDER_FALLBACK'];
    delete process.env['SHIPYARD_NO_FALLBACK_SOURCES'];
    process.env['SHIPYARD_REQUIRED_PROVIDERS'] = 'anthropic';
    const policy = getProviderPolicy();
    expect(policy.requiredProviders).toEqual(['anthropic']);
  });

  it('preserves source in policy', () => {
    delete process.env['SHIPYARD_ALLOW_PROVIDER_FALLBACK'];
    delete process.env['SHIPYARD_NO_FALLBACK_SOURCES'];
    delete process.env['SHIPYARD_REQUIRED_PROVIDERS'];
    const policy = getProviderPolicy('github_webhook');
    expect(policy.source).toBe('github_webhook');
  });
});

// ---------------------------------------------------------------------------
// enforceProviderPolicy
// ---------------------------------------------------------------------------

describe('enforceProviderPolicy', () => {
  beforeEach(() => {
    saveEnv('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY');
  });

  afterEach(restoreEnv);

  it('does not throw when no required providers', () => {
    expect(() =>
      enforceProviderPolicy({
        allowFallback: true,
        requiredProviders: [],
      }),
    ).not.toThrow();
  });

  it('does not throw when required provider is available', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key-1234';
    expect(() =>
      enforceProviderPolicy({
        allowFallback: false,
        requiredProviders: ['openai'],
      }),
    ).not.toThrow();
  });

  it('throws ProviderPolicyError when required provider missing and no fallback', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    try {
      enforceProviderPolicy({
        allowFallback: false,
        requiredProviders: ['anthropic'],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderPolicyError);
      const policyErr = err as ProviderPolicyError;
      expect(policyErr.violations).toHaveLength(1);
      expect(policyErr.violations[0]?.provider).toBe('anthropic');
      expect(policyErr.message).toContain('anthropic');
      expect(policyErr.message).toContain('SHIPYARD_ALLOW_PROVIDER_FALLBACK');
    }
  });

  it('does not throw when fallback allowed and another LLM provider exists', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key-1234';
    // Anthropic required but missing; fallback allowed + openai available = pass
    expect(() =>
      enforceProviderPolicy({
        allowFallback: true,
        requiredProviders: ['anthropic'],
      }),
    ).not.toThrow();
  });

  it('throws when fallback allowed but NO LLM provider available at all', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    expect(() =>
      enforceProviderPolicy({
        allowFallback: true,
        requiredProviders: ['anthropic'],
      }),
    ).toThrow(ProviderPolicyError);
  });

  it('includes remediation hints in violations', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    try {
      enforceProviderPolicy({
        allowFallback: false,
        requiredProviders: ['anthropic', 'openai'],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      const policyErr = err as ProviderPolicyError;
      expect(policyErr.violations).toHaveLength(2);
      expect(policyErr.violations[0]?.remediation).toBeTruthy();
      expect(policyErr.violations[1]?.remediation).toBeTruthy();
    }
  });
});
