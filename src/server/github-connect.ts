import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createSign } from 'node:crypto';

export interface GithubRepoSummary {
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

export interface GithubInstallationSummary {
  id: number;
  account_login: string;
  account_type: string;
  target_type: string;
  repository_selection: string;
  html_url: string;
}

interface GithubAppConfig {
  issuer: string;
  privateKey: string;
}

function runGit(args: string[], cwd?: string): Promise<{ ok: boolean; stdout: string; stderr: string; message?: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '', message: error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function runGh(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; message?: string }> {
  return new Promise((resolve) => {
    execFile('gh', args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '', message: error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function gitAuthArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

export function githubAppMissingEnv(): string[] {
  const appId = process.env['GITHUB_APP_ID']?.trim() ?? '';
  const clientId = process.env['GITHUB_APP_CLIENT_ID']?.trim() ?? '';
  const privateKeyRaw = process.env['GITHUB_APP_PRIVATE_KEY']?.trim() ?? '';
  const missing: string[] = [];
  if (!appId && !clientId) missing.push('GITHUB_APP_ID or GITHUB_APP_CLIENT_ID');
  if (!privateKeyRaw) missing.push('GITHUB_APP_PRIVATE_KEY');
  return missing;
}

function githubAppConfig(): GithubAppConfig | null {
  if (githubAppMissingEnv().length > 0) return null;
  const appId = process.env['GITHUB_APP_ID']?.trim() ?? '';
  const clientId = process.env['GITHUB_APP_CLIENT_ID']?.trim() ?? '';
  const issuer = clientId || appId;
  const privateKeyRaw = process.env['GITHUB_APP_PRIVATE_KEY']?.trim() ?? '';
  const privateKey = privateKeyRaw.includes('\\n')
    ? privateKeyRaw.replace(/\\n/g, '\n')
    : privateKeyRaw;
  return { issuer, privateKey };
}

function base64Url(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildAppJwt(config: GithubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iat: now - 30,
    exp: now + 9 * 60,
    iss: config.issuer,
  }));
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(config.privateKey);
  return `${signingInput}.${base64Url(sig)}`;
}

export async function createInstallationTokenForRepo(owner: string, repo: string): Promise<string | null> {
  const cfg = githubAppConfig();
  if (!cfg) return null;
  const appJwt = buildAppJwt(cfg);

  const installRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shipyard-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!installRes.ok) return null;
  const installBody = (await installRes.json()) as Record<string, unknown>;
  const installationId = Number(installBody['id'] ?? 0);
  if (!installationId) return null;

  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shipyard-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!tokenRes.ok) return null;
  const tokenBody = (await tokenRes.json()) as Record<string, unknown>;
  const token = String(tokenBody['token'] ?? '');
  return token || null;
}

export async function createInstallationTokenById(installationId: number): Promise<string | null> {
  const cfg = githubAppConfig();
  if (!cfg || !installationId) return null;
  const appJwt = buildAppJwt(cfg);
  const tokenRes = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shipyard-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!tokenRes.ok) return null;
  const body = (await tokenRes.json()) as Record<string, unknown>;
  const token = String(body['token'] ?? '');
  return token || null;
}

export async function listGithubAppInstallations(): Promise<GithubInstallationSummary[]> {
  const cfg = githubAppConfig();
  if (!cfg) throw new Error('GitHub App is not configured.');
  const appJwt = buildAppJwt(cfg);
  const installations: GithubInstallationSummary[] = [];
  let page = 1;

  while (page <= 5) {
    const res = await fetch(`https://api.github.com/app/installations?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'shipyard-agent',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub app installations error (${res.status}): ${txt.slice(0, 240)}`);
    }
    const body = await res.json() as Array<Record<string, unknown>>;
    const pageInstallations = Array.isArray(body) ? body : [];
    if (pageInstallations.length === 0) break;

    for (const installation of pageInstallations) {
      const account = installation['account'] && typeof installation['account'] === 'object'
        ? installation['account'] as Record<string, unknown>
        : null;
      const id = Number(installation['id'] ?? 0);
      if (!id) continue;
      installations.push({
        id,
        account_login: String(account?.['login'] ?? `installation-${id}`),
        account_type: String(account?.['type'] ?? ''),
        target_type: String(installation['target_type'] ?? ''),
        repository_selection: String(installation['repository_selection'] ?? 'selected'),
        html_url: String(installation['html_url'] ?? ''),
      });
    }

    page += 1;
  }

  return installations.sort((a, b) => (
    a.account_login.localeCompare(b.account_login) || a.id - b.id
  ));
}

export async function listGithubReposForInstallation(installationId: number, query?: string): Promise<GithubRepoSummary[]> {
  const token = await createInstallationTokenById(installationId);
  if (!token) throw new Error('Failed to create GitHub installation token.');
  const repos: GithubRepoSummary[] = [];
  let page = 1;
  const q = query?.trim().toLowerCase();
  while (page <= 5) {
    const res = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'shipyard-agent',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub installation repos error (${res.status}): ${txt.slice(0, 240)}`);
    }
    const body = (await res.json()) as { repositories?: Array<Record<string, unknown>> };
    const pageRepos = Array.isArray(body.repositories) ? body.repositories : [];
    if (pageRepos.length === 0) break;
    for (const repo of pageRepos) {
      const fullName = String(repo['full_name'] ?? '');
      if (!fullName) continue;
      if (q && !fullName.toLowerCase().includes(q)) continue;
      repos.push({
        full_name: fullName,
        private: Boolean(repo['private']),
        default_branch: String(repo['default_branch'] ?? 'main'),
        html_url: String(repo['html_url'] ?? ''),
      });
    }
    page += 1;
  }
  return repos.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function cloneOrUpdateGithubRepo(token: string, owner: string, repo: string, rootDir: string, installationId?: number): Promise<{
  workDir: string;
  branch: string;
}> {
  const safeOwner = owner.trim();
  const safeRepo = repo.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(safeOwner) || !/^[A-Za-z0-9_.-]+$/.test(safeRepo)) {
    throw new Error('Invalid owner or repo format');
  }

  const targetDir = path.join(rootDir, `${safeOwner}__${safeRepo}`);
  await mkdir(rootDir, { recursive: true });

  const repoUrl = `https://github.com/${safeOwner}/${safeRepo}.git`;
  const appToken = installationId
    ? await createInstallationTokenById(installationId)
    : await createInstallationTokenForRepo(safeOwner, safeRepo);
  const activeToken = appToken ?? token;
  const authArgs = gitAuthArgs(activeToken);

  if (!existsSync(path.join(targetDir, '.git'))) {
    const clone = await runGit([...authArgs, 'clone', repoUrl, targetDir]);
    if (!clone.ok) {
      throw new Error(`Clone failed: ${clone.stderr || clone.message || 'unknown error'}`);
    }
  } else {
    const remote = await runGit(['remote', 'get-url', 'origin'], targetDir);
    if (!remote.ok || !remote.stdout.trim().includes(`${safeOwner}/${safeRepo}`)) {
      throw new Error('Existing directory origin does not match requested repository');
    }
    const fetch = await runGit([...authArgs, 'fetch', '--all', '--prune'], targetDir);
    if (!fetch.ok) {
      throw new Error(`Fetch failed: ${fetch.stderr || fetch.message || 'unknown error'}`);
    }
  }

  const branchRes = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], targetDir);
  const branch = branchRes.ok ? branchRes.stdout.trim().replace(/^origin\//, '') : 'main';

  const checkout = await runGit(['checkout', branch], targetDir);
  if (!checkout.ok) {
    throw new Error(`Checkout failed: ${checkout.stderr || checkout.message || 'unknown error'}`);
  }

  const pull = await runGit([...authArgs, 'pull', '--ff-only', 'origin', branch], targetDir);
  if (!pull.ok) {
    throw new Error(`Pull failed: ${pull.stderr || pull.message || 'unknown error'}`);
  }

  return { workDir: targetDir, branch };
}

export async function githubCliAuthStatus(): Promise<boolean> {
  const status = await runGh(['auth', 'status']);
  return status.ok;
}

export function githubAppConfigured(): boolean {
  return githubAppMissingEnv().length === 0;
}
