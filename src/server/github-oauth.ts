import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

const SESSION_COOKIE = 'shipyard_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_SESSIONS = 10_000;
const GITHUB_INSTALL_CALLBACK_PATH = '/api/github/install/callback';

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

function headerValue(req: Pick<Request, 'headers'>, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? '';
  return raw?.trim() ?? '';
}

function forwardedValue(req: Pick<Request, 'headers'>, name: string): string {
  const raw = headerValue(req, name);
  if (!raw) return '';
  return raw.split(',')[0]?.trim() ?? '';
}

function now(): number {
  return Date.now();
}

function shouldUseSecureCookie(req: Pick<Request, 'headers' | 'protocol'>): boolean {
  const origin = githubPublicOrigin(req).toLowerCase();
  if (!origin.startsWith('https://')) return false;
  return !origin.startsWith('https://localhost') &&
    !origin.startsWith('https://127.0.0.1') &&
    !origin.startsWith('https://[::1]');
}

function cleanupSessions(): void {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [sid, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(sid);
  }
}

export function getOrCreateOAuthSession(req: Request, res: Response): OAuthSession {
  cleanupSessions();
  if (sessions.size >= MAX_SESSIONS) {
    const excess = sessions.size - MAX_SESSIONS + 1;
    const iter = sessions.keys();
    for (let i = 0; i < excess; i++) {
      const key = iter.next().value;
      if (key !== undefined) sessions.delete(key);
    }
  }
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
    secure: shouldUseSecureCookie(req),
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

export function githubInstallMissingEnv(): string[] {
  return githubAppSlug() ? [] : ['GITHUB_APP_SLUG'];
}

export function githubInstallConfigured(): boolean {
  return githubInstallMissingEnv().length === 0;
}

export function githubInstallCallbackPath(): string {
  return GITHUB_INSTALL_CALLBACK_PATH;
}

export function githubPublicOrigin(req: Pick<Request, 'headers' | 'protocol'>): string {
  const explicit =
    process.env['SHIPYARD_PUBLIC_BASE_URL']?.trim() ||
    process.env['PUBLIC_BASE_URL']?.trim() ||
    process.env['APP_URL']?.trim() ||
    '';
  if (explicit) return explicit.replace(/\/+$/, '');

  const proto = forwardedValue(req, 'x-forwarded-proto') || req.protocol || 'http';
  const host = forwardedValue(req, 'x-forwarded-host') || headerValue(req, 'host') || 'localhost';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function githubInstallCallbackUrl(req: Pick<Request, 'headers' | 'protocol'>): string {
  return `${githubPublicOrigin(req)}${GITHUB_INSTALL_CALLBACK_PATH}`;
}

export function buildGithubInstallStartUrl(session: OAuthSession): string {
  const slug = githubAppSlug();
  const state = randomBytes(24).toString('hex');
  session.pendingState = state;
  const u = new URL(`https://github.com/apps/${slug}/installations/new`);
  u.searchParams.set('state', state);
  return u.toString();
}
