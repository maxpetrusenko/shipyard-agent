import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(new InstructionLoop());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, baseUrl: `http://localhost:${port}/api` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function saveGithubEnv(): Record<string, string | undefined> {
  return {
    GITHUB_APP_SLUG: process.env['GITHUB_APP_SLUG'],
    GITHUB_APP_ID: process.env['GITHUB_APP_ID'],
    GITHUB_APP_PRIVATE_KEY: process.env['GITHUB_APP_PRIVATE_KEY'],
    GITHUB_APP_CLIENT_ID: process.env['GITHUB_APP_CLIENT_ID'],
  };
}

function restoreGithubEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('GitHub install fallback flow', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveGithubEnv();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env['GITHUB_APP_SLUG'] = 'shipyard-test';
    process.env['GITHUB_APP_ID'] = '123456';
    process.env['GITHUB_APP_PRIVATE_KEY'] = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    delete process.env['GITHUB_APP_CLIENT_ID'];
  });

  afterEach(() => {
    restoreGithubEnv(savedEnv);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists visible app installations for manual selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.github.com/app/installations?per_page=100&page=1') {
        return jsonResponse([
          { id: 88, account: { login: 'zeta', type: 'Organization' }, target_type: 'Organization', repository_selection: 'selected', html_url: 'https://github.com/settings/installations/88' },
          { id: 77, account: { login: 'alpha', type: 'User' }, target_type: 'User', repository_selection: 'all', html_url: 'https://github.com/settings/installations/77' },
        ]);
      }
      if (url === 'https://api.github.com/app/installations?per_page=100&page=2') {
        return jsonResponse([]);
      }
      return realFetch(input, init);
    }));

    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/github/installations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        installations: Array<{ id: number; account_login: string; repository_selection: string }>;
      };
      expect(body.installations.map((installation) => ({
        id: installation.id,
        account_login: installation.account_login,
        repository_selection: installation.repository_selection,
      }))).toEqual([
        { id: 77, account_login: 'alpha', repository_selection: 'all' },
        { id: 88, account_login: 'zeta', repository_selection: 'selected' },
      ]);
    } finally {
      await stopServer(server);
    }
  });

  it('binds a selected installation to the session and then loads repos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://api.github.com/app/installations/77/access_tokens') {
        return jsonResponse({ token: 'inst-token' });
      }
      if (url === 'https://api.github.com/installation/repositories?per_page=100&page=1') {
        const headers = new Headers(init?.headers);
        expect(headers.get('Authorization')).toBe('Bearer inst-token');
        return jsonResponse({
          repositories: [
            {
              full_name: 'max/ship-agent',
              private: true,
              default_branch: 'main',
              html_url: 'https://github.com/max/ship-agent',
            },
          ],
        });
      }
      if (url === 'https://api.github.com/installation/repositories?per_page=100&page=2') {
        return jsonResponse({ repositories: [] });
      }
      return realFetch(input, init);
    }));

    const { server, baseUrl } = await startServer();
    try {
      const selectRes = await fetch(`${baseUrl}/github/install/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: 77 }),
      });
      expect(selectRes.status).toBe(200);
      const cookie = selectRes.headers.get('set-cookie');
      expect(cookie).toContain('shipyard_sid=');

      const reposRes = await fetch(`${baseUrl}/github/repos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: String(cookie).split(';')[0] || '',
        },
        body: JSON.stringify({ query: 'ship' }),
      });
      expect(reposRes.status).toBe(200);
      const body = await reposRes.json() as {
        repos: Array<{ full_name: string }>;
        authSource: string;
      };
      expect(body.authSource).toBe('installation');
      expect(body.repos.map((repo) => repo.full_name)).toEqual(['max/ship-agent']);
    } finally {
      await stopServer(server);
    }
  });

  it('rejects callback when state is missing or mismatched', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const startRes = await fetch(`${baseUrl}/github/install/start`, {
        redirect: 'manual',
      });
      expect(startRes.status).toBe(302);
      const cookie = startRes.headers.get('set-cookie');
      const location = startRes.headers.get('location') ?? '';
      const state = new URL(location).searchParams.get('state');
      expect(cookie).toContain('shipyard_sid=');
      expect(state).toBeTruthy();

      const missingStateRes = await fetch(`${baseUrl}/github/install/callback?installation_id=77`, {
        headers: { Cookie: String(cookie).split(';')[0] || '' },
      });
      expect(missingStateRes.status).toBe(400);
      expect(await missingStateRes.text()).toContain('Invalid install state.');

      const wrongStateRes = await fetch(`${baseUrl}/github/install/callback?installation_id=77&state=wrong`, {
        headers: { Cookie: String(cookie).split(';')[0] || '' },
      });
      expect(wrongStateRes.status).toBe(400);
      expect(await wrongStateRes.text()).toContain('Invalid install state.');
    } finally {
      await stopServer(server);
    }
  });

  it('marks session cookies secure behind https public origins', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/github/install/start`, {
        redirect: 'manual',
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'agent.example.com',
        },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get('set-cookie')).toContain('Secure');
    } finally {
      await stopServer(server);
    }
  });
});
