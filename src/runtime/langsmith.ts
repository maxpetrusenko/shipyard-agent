/**
 * LangSmith tracing helpers.
 *
 * Automatic via env vars when LANGCHAIN_TRACING_V2=true or LANGSMITH_TRACING=true.
 * Creates public share links so traces are accessible without workspace auth.
 */

import { Client } from 'langsmith';

// ---------------------------------------------------------------------------
// Env helpers (support both modern LANGSMITH_* and legacy LANGCHAIN_* vars)
// ---------------------------------------------------------------------------

export function getLangSmithApiKey(): string | null {
  return (
    process.env['LANGSMITH_API_KEY']?.trim() ||
    process.env['LANGCHAIN_API_KEY']?.trim() ||
    null
  );
}

export function isTracingEnabled(): boolean {
  return (
    process.env['LANGSMITH_TRACING'] === 'true' ||
    process.env['LANGCHAIN_TRACING_V2'] === 'true'
  );
}

export function canTrace(): boolean {
  return isTracingEnabled() && getLangSmithApiKey() !== null;
}

export function getTraceProject(): string {
  return (
    process.env['LANGSMITH_PROJECT'] ??
    process.env['LANGCHAIN_PROJECT'] ??
    'shipyard'
  );
}

// ---------------------------------------------------------------------------
// Public trace URL resolution (idempotent share-or-reuse)
// ---------------------------------------------------------------------------

interface LangSmithRunUrlClient {
  getRunUrl?: (params: { runId: string }) => Promise<string>;
  readRunSharedLink: (runId: string) => Promise<string | undefined>;
  shareRun: (runId: string) => Promise<string>;
}

const LANGSMITH_HOST = 'smith.langchain.com';

export function isLangSmithPublicTraceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === LANGSMITH_HOST &&
      /^\/public\/[^/]+\/r\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function isLangSmithInternalTraceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === LANGSMITH_HOST &&
      /^\/o\/[^/]+\/projects\/p\/[^/]+\/r\/[^/]+\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function getErrorStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === 'number' ? status : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

/**
 * Whether public trace sharing is explicitly opted in.
 * Default: false (internal workspace URLs only).
 */
export function isPublicTraceEnabled(): boolean {
  return process.env['SHIPYARD_TRACE_PUBLIC'] === 'true';
}

/**
 * Resolve a LangSmith trace URL for a run.
 *
 * By default returns an internal workspace URL. When SHIPYARD_TRACE_PUBLIC=true,
 * creates a public share link via the LangSmith API.
 *
 * Public strategy (idempotent):
 * 1. Try readRunSharedLink — reuse existing public link
 * 2. If 404 (not shared yet), call shareRun — creates public link
 * 3. Retry up to 5 times with exponential backoff (handles transient 404s
 *    when LangSmith hasn't finalized the run yet)
 */
export async function resolveLangSmithRunUrl(
  runId: string,
  client?: LangSmithRunUrlClient,
  maxAttempts = 5,
  retryDelayMs = 250,
): Promise<string | null> {
  if (!runId || !canTrace()) return null;

  // Default: internal workspace URL (no public sharing)
  if (!isPublicTraceEnabled()) {
    return buildTraceUrl(runId);
  }

  const lsClient = client ?? new Client({
    apiKey: getLangSmithApiKey() ?? undefined,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Try to reuse existing public link
      let existing: string | undefined;
      try {
        existing = await lsClient.readRunSharedLink(runId);
      } catch (err) {
        if (getErrorStatus(err) !== 404) throw err;
      }

      if (existing && isLangSmithPublicTraceUrl(existing)) return existing;

      // Create new public share link
      const shared = await lsClient.shareRun(runId);
      if (isLangSmithPublicTraceUrl(shared)) return shared;
      console.warn('[shipyard] LangSmith shareRun returned a non-public URL:', shared);
      return null;
    } catch (err) {
      const shouldRetry = getErrorStatus(err) === 404 && attempt < maxAttempts;
      if (shouldRetry) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      console.warn('[shipyard] Failed to resolve LangSmith public trace URL:', err);
      return null;
    }
  }

  return null;
}

/**
 * Build a private LangSmith trace URL (fallback when share fails).
 */
export function buildTraceUrl(runId: string): string | null {
  if (!isTracingEnabled()) return null;
  const project = getTraceProject();
  return `https://smith.langchain.com/o/default/projects/p/${project}/r/${runId}`;
}
