import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

const SESSION_COOKIE = 'shipyard_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

interface OAuthSession {
  sid: string;
  createdAt: number;
  pendingState?: string;
  githubInstallationId?: number;
}

const sessions = new Map<string, OAuthSession>();

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return raw.split(';').reduce<Record<string, string>>((acc, part) => {
    const i = part.indexOf('=');
    if (i <= 0) return acc;
    const key = decodeURIComponent(part.slice(0, i).trim());
    const value = decodeURIComponent(part.slice(i + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

function now(): number {
  return Date.now();
}

function cleanupSessions(): void {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [sid, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(sid);
  }
}

export function getOrCreateOAuthSession(req: Request, res: Response): OAuthSession {
  cleanupSessions();
  const cookies = parseCookies(req.headers.cookie);
  const existingSid = cookies[SESSION_COOKIE];
  if (existingSid) {
    const existing = sessions.get(existingSid);
    if (existing) return existing;
  }
  const sid = randomBytes(24).toString('hex');
  const session: OAuthSession = { sid, createdAt: now() };
  sessions.set(sid, session);
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
  return session;
}

export function clearSessionGithub(session: OAuthSession): void {
  session.pendingState = undefined;
  session.githubInstallationId = undefined;
  session.createdAt = now();
}

export function setSessionGithubInstallation(session: OAuthSession, installationId: number): void {
  session.githubInstallationId = installationId;
  session.createdAt = now();
}

export function getSessionGithubInstallationId(session: OAuthSession): number | null {
  return session.githubInstallationId ?? null;
}

export function githubAppSlug(): string {
  return process.env['GITHUB_APP_SLUG']?.trim() ?? '';
}

export function githubInstallConfigured(): boolean {
  return Boolean(githubAppSlug());
}

export function buildGithubInstallStartUrl(session: OAuthSession): string {
  const slug = githubAppSlug();
  const state = randomBytes(24).toString('hex');
  session.pendingState = state;
  const u = new URL(`https://github.com/apps/${slug}/installations/new`);
  u.searchParams.set('state', state);
  return u.toString();
}
