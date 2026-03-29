import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(new InstructionLoop());
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://localhost:${port}/api` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function saveGithubEnv(): Record<string, string | undefined> {
  return {
    GITHUB_APP_SLUG: process.env['GITHUB_APP_SLUG'],
    GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
    GITHUB_APP_CLIENT_ID: process.env['GITHUB_APP_CLIENT_ID'],
    GITHUB_APP_PRIVATE_KEY: process.env['GITHUB_APP_PRIVATE_KEY'],
    SHIPYARD_PUBLIC_BASE_URL: process.env['SHIPYARD_PUBLIC_BASE_URL'],
    PUBLIC_BASE_URL: process.env['PUBLIC_BASE_URL'],
    APP_URL: process.env['APP_URL'],
  };
}

function restoreGithubEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearGithubEnv(): void {
  delete process.env['GITHUB_APP_SLUG'];
  delete process.env['GITHUB_APP_ID'];
  delete process.env['GITHUB_APP_CLIENT_ID'];
  delete process.env['GITHUB_APP_PRIVATE_KEY'];
  delete process.env['SHIPYARD_PUBLIC_BASE_URL'];
  delete process.env['PUBLIC_BASE_URL'];
  delete process.env['APP_URL'];
}

afterEach(() => {
  clearGithubEnv();
});

describe('GET /settings/status GitHub diagnostics', () => {
  it('reports missing env and forwarded callback URL for deployed hosts', async () => {
    const savedEnv = saveGithubEnv();
    clearGithubEnv();
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/settings/status`, {
        headers: {
          'X-Forwarded-Host': 'agent.ship.187.77.7.226.sslip.io',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        githubInstallConfigured: boolean;
        githubAppConfigured: boolean;
        githubInstallMissing: string[];
        githubAppMissing: string[];
        githubInstallCallbackUrl: string;
      };
      expect(body.githubInstallConfigured).toBe(false);
      expect(body.githubAppConfigured).toBe(false);
      expect(body.githubInstallMissing).toEqual(['GITHUB_APP_SLUG']);
      expect(body.githubAppMissing).toEqual(['GITHUB_APP_ID or GITHUB_APP_CLIENT_ID', 'GITHUB_APP_PRIVATE_KEY']);
      expect(body.githubInstallCallbackUrl).toBe('https://agent.ship.187.77.7.226.sslip.io/api/github/install/callback');
    } finally {
      await stopServer(server);
      restoreGithubEnv(savedEnv);
    }
  });

  it('reports GitHub App as ready when slug and token env are present', async () => {
    const savedEnv = saveGithubEnv();
    clearGithubEnv();
    process.env['GITHUB_APP_SLUG'] = 'shipyard-test-app';
    process.env['GITHUB_APP_ID'] = '123456';
    process.env['GITHUB_APP_PRIVATE_KEY'] = '-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----';
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/settings/status`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        githubInstallConfigured: boolean;
        githubAppConfigured: boolean;
        githubInstallMissing: string[];
        githubAppMissing: string[];
      };
      expect(body.githubInstallConfigured).toBe(true);
      expect(body.githubAppConfigured).toBe(true);
      expect(body.githubInstallMissing).toEqual([]);
      expect(body.githubAppMissing).toEqual([]);
    } finally {
      await stopServer(server);
      restoreGithubEnv(savedEnv);
    }
  });
});
