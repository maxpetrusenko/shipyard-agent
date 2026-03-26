/**
 * Provider readiness check tests.
 *
 * Validates checkProviderReadiness() under various env var combinations
 * and verifies the GET /api/providers/readiness endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkProviderReadiness } from '../../src/server/provider-readiness.js';
import { resetCodexCliStatusCache } from '../../src/server/codex-cli-status.js';

// ---------------------------------------------------------------------------
// Helpers to save/restore env
// ---------------------------------------------------------------------------

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'SHIPYARD_CODEX_CLI_FORCE_INSTALLED',
  'SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED',
];

describe('checkProviderReadiness', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv(ENV_KEYS);
    resetCodexCliStatusCache();
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    resetCodexCliStatusCache();
  });

  it('returns ready: false with no env vars', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];
    process.env['SHIPYARD_CODEX_CLI_FORCE_INSTALLED'] = '0';
    process.env['SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED'] = '0';

    const report = await checkProviderReadiness();

    expect(report.ready).toBe(false);
    expect(report.providers).toHaveLength(3);
    expect(report.timestamp).toBeTruthy();

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(false);
    expect(anthropic?.authMethod).toBe('none');
    expect(anthropic?.remediation).toBeTruthy();
    expect(anthropic?.remediation).toContain('ANTHROPIC_API_KEY');

    const openai = report.providers.find((p) => p.provider === 'openai');
    expect(openai?.available).toBe(false);
    expect(openai?.remediation).toContain('OPENAI_API_KEY');

    const codex = report.providers.find((p) => p.provider === 'codex');
    expect(codex?.available).toBe(false);
    expect(codex?.remediation).toBeTruthy();
  });

  it('returns anthropic available with ANTHROPIC_API_KEY', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key-1234567890';
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];

    const report = await checkProviderReadiness();

    expect(report.ready).toBe(true);

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(true);
    expect(anthropic?.authMethod).toBe('api_key');
    expect(anthropic?.remediation).toBeUndefined();
  });

  it('returns anthropic available with ANTHROPIC_AUTH_TOKEN (OAuth)', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'oauth-test-token-value';
    delete process.env['OPENAI_API_KEY'];

    const report = await checkProviderReadiness();

    expect(report.ready).toBe(true);

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(true);
    expect(anthropic?.authMethod).toBe('oauth_env');
    expect(anthropic?.detail).toContain('OAuth');
  });

  it('returns openai available with OPENAI_API_KEY', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    process.env['OPENAI_API_KEY'] = 'sk-openai-test-key';

    const report = await checkProviderReadiness();

    expect(report.ready).toBe(true);

    const openai = report.providers.find((p) => p.provider === 'openai');
    expect(openai?.available).toBe(true);
    expect(openai?.authMethod).toBe('api_key');
    expect(openai?.remediation).toBeUndefined();
  });

  it('returns ready: true with both providers', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-both';
    process.env['OPENAI_API_KEY'] = 'sk-openai-test-both';

    const report = await checkProviderReadiness();

    expect(report.ready).toBe(true);

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(true);

    const openai = report.providers.find((p) => p.provider === 'openai');
    expect(openai?.available).toBe(true);
  });

  it('treats dummy/oauth placeholder API keys as unavailable', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'dummy';
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];

    const report = await checkProviderReadiness();
    expect(report.ready).toBe(false);

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(false);
    expect(anthropic?.authMethod).toBe('none');
  });

  it('reports codex CLI installed and authenticated', async () => {
    process.env['SHIPYARD_CODEX_CLI_FORCE_INSTALLED'] = '1';
    process.env['SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED'] = '1';

    const report = await checkProviderReadiness();

    const codex = report.providers.find((p) => p.provider === 'codex');
    expect(codex?.available).toBe(true);
    expect(codex?.detail).toContain('authenticated');
    expect(codex?.remediation).toBeUndefined();
  });

  it('reports codex CLI installed but not authenticated', async () => {
    process.env['SHIPYARD_CODEX_CLI_FORCE_INSTALLED'] = '1';
    process.env['SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED'] = '0';

    const report = await checkProviderReadiness();

    const codex = report.providers.find((p) => p.provider === 'codex');
    expect(codex?.available).toBe(false);
    expect(codex?.detail).toContain('not authenticated');
    expect(codex?.remediation).toContain('codex auth');
  });

  it('prefers API key over OAuth when both are set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-real-key';
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'oauth-token-also-set';

    const report = await checkProviderReadiness();

    const anthropic = report.providers.find((p) => p.provider === 'anthropic');
    expect(anthropic?.available).toBe(true);
    expect(anthropic?.authMethod).toBe('api_key');
  });
});

// ---------------------------------------------------------------------------
// Endpoint integration test
// ---------------------------------------------------------------------------

import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

describe('GET /api/providers/readiness', () => {
  let server: Server;
  let baseUrl: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedEnv = saveEnv(ENV_KEYS);
    resetCodexCliStatusCache();
    const loop = new InstructionLoop();
    const app = createApp(loop);
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        baseUrl = `http://localhost:${port}/api`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    restoreEnv(savedEnv);
    resetCodexCliStatusCache();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns a valid ReadinessReport JSON', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-endpoint-test';
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    process.env['OPENAI_API_KEY'] = 'sk-openai-endpoint-test';

    const res = await fetch(`${baseUrl}/providers/readiness`);
    expect(res.status).toBe(200);

    const report = (await res.json()) as {
      ready: boolean;
      providers: Array<{
        provider: string;
        available: boolean;
        authMethod: string;
        detail: string;
        remediation?: string;
      }>;
      timestamp: string;
    };

    expect(report.ready).toBe(true);
    expect(report.providers).toHaveLength(3);
    expect(report.timestamp).toBeTruthy();

    const names = report.providers.map((p) => p.provider).sort();
    expect(names).toEqual(['anthropic', 'codex', 'openai']);
  });

  it('returns ready: false when no LLM keys are set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_AUTH_TOKEN'];
    delete process.env['OPENAI_API_KEY'];

    const res = await fetch(`${baseUrl}/providers/readiness`);
    expect(res.status).toBe(200);

    const report = (await res.json()) as { ready: boolean };
    expect(report.ready).toBe(false);
  });
});
