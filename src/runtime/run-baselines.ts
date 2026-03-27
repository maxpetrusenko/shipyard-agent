/**
 * Per-run git baselines to detect file changes made outside edit/write tools.
 * Also captures pre-run verification fingerprints for baseline diffing.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { runBash, type BashResult, type BashParams } from '../tools/bash.js';

interface VerificationFingerprint {
  /** Hash of lint + typecheck + test output before the run. */
  hash: string;
  /** Individual error lines for set-difference diffing. */
  errorLines: string[];
}

interface RunBaseline {
  head: string | null;
  dirtyFiles: Set<string>;
  verificationFingerprint: VerificationFingerprint | null;
}

const baselines = new Map<string, RunBaseline>();

export type BashRunner = (params: BashParams) => Promise<BashResult>;

function parseLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runAndCollectLines(
  command: string,
  cwd: string,
  runner: BashRunner,
): Promise<string[]> {
  const res = await runner({ command, cwd, timeout: 30_000 });
  if (!res.success) return [];
  return parseLines(res.stdout);
}

async function readDirtyFiles(
  cwd: string,
  runner: BashRunner,
): Promise<Set<string>> {
  const files = new Set<string>();
  const commands = [
    'git diff --name-only',
    'git diff --name-only --cached',
    'git ls-files --others --exclude-standard',
  ];
  for (const command of commands) {
    const lines = await runAndCollectLines(command, cwd, runner);
    for (const line of lines) files.add(line);
  }
  return files;
}

async function readHeadSha(
  cwd: string,
  runner: BashRunner,
): Promise<string | null> {
  const head = await runner({
    command: 'git rev-parse HEAD',
    cwd,
    timeout: 30_000,
  });
  if (!head.success) return null;
  const sha = head.stdout.trim();
  return sha.length > 0 ? sha : null;
}

function normalizeToAbsolute(cwd: string, path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(cwd, path);
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function extractVerificationErrorLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.includes('error TS')) return true;
      if (/^\s*✗|^\s*×|FAIL\s/.test(line)) return true;
      if (/^\s*\d+:\d+\s+error\s/.test(line)) return true; // ESLint
      return false;
    });
}

async function captureVerificationFingerprint(
  cwd: string,
  runner: BashRunner,
): Promise<VerificationFingerprint | null> {
  try {
    const results = await Promise.all([
      runner({ command: 'pnpm type-check 2>&1', cwd, timeout: 120_000 }),
      runner({ command: 'pnpm run lint --if-present 2>&1', cwd, timeout: 120_000 }),
      runner({ command: 'pnpm test 2>&1', cwd, timeout: 300_000 }),
    ]);
    const combined = results.map((r) => `${r.stdout}\n${r.stderr}`).join('\n');
    const errorLines = extractVerificationErrorLines(combined);
    return {
      hash: hashString(errorLines.sort().join('\n')),
      errorLines: errorLines.sort(),
    };
  } catch {
    return null;
  }
}

// Pending verification fingerprint promises (resolved in background)
const pendingFingerprints = new Map<string, Promise<VerificationFingerprint | null>>();

export async function captureRunBaseline(
  runId: string,
  cwd: string,
  runner: BashRunner = runBash,
): Promise<void> {
  // Register a deferred fingerprint promise SYNCHRONOUSLY (before any await)
  // so that getBaselineFingerprint() always has something to await, even if
  // called before the git ops below complete. This prevents the race where
  // verify runs before baseline capture finishes.
  let resolveDeferred!: (fp: VerificationFingerprint | null) => void;
  const deferred = new Promise<VerificationFingerprint | null>((resolve) => {
    resolveDeferred = resolve;
  });
  pendingFingerprints.set(runId, deferred);

  try {
    // Fast: only git operations (< 1s)
    const [head, dirtyFiles] = await Promise.all([
      readHeadSha(cwd, runner),
      readDirtyFiles(cwd, runner),
    ]);
    baselines.set(runId, { head, dirtyFiles, verificationFingerprint: null });
  } catch {
    // Git ops failed — resolve deferred with null so getBaselineFingerprint
    // does not hang, and return early (no point capturing fingerprint).
    resolveDeferred(null);
    pendingFingerprints.delete(runId);
    return;
  }

  // Slow: fingerprint capture runs in background — do NOT await here so
  // captureRunBaseline() returns quickly (off the critical path).
  // The deferred promise resolves when the fingerprint is ready;
  // getBaselineFingerprint() awaits it in verify.
  captureVerificationFingerprint(cwd, runner)
    .then((fp) => {
      const existing = baselines.get(runId);
      if (existing) existing.verificationFingerprint = fp;
      resolveDeferred(fp);
    })
    .catch(() => resolveDeferred(null))
    .finally(() => pendingFingerprints.delete(runId));
}

/**
 * Wait for and return the baseline verification fingerprint.
 * Returns immediately if already resolved, or waits for the background capture.
 */
export async function getBaselineFingerprint(runId: string): Promise<VerificationFingerprint | null> {
  const baseline = baselines.get(runId);
  if (baseline?.verificationFingerprint) return baseline.verificationFingerprint;
  const pending = pendingFingerprints.get(runId);
  if (pending) return pending;
  return null;
}

export function clearRunBaseline(runId: string): void {
  baselines.delete(runId);
  pendingFingerprints.delete(runId);
}

export async function detectObservedChangedFiles(
  runId: string,
  cwd: string,
  runner: BashRunner = runBash,
): Promise<string[]> {
  const baseline = baselines.get(runId);
  if (!baseline) return [];

  const observed = new Set<string>();
  const [currentHead, currentDirty] = await Promise.all([
    readHeadSha(cwd, runner),
    readDirtyFiles(cwd, runner),
  ]);

  for (const path of currentDirty) {
    if (!baseline.dirtyFiles.has(path)) observed.add(path);
  }

  if (baseline.head && currentHead && baseline.head !== currentHead) {
    const res = await runner({
      command: `git diff --name-only ${baseline.head}..${currentHead}`,
      cwd,
      timeout: 30_000,
    });
    if (res.success) {
      for (const path of parseLines(res.stdout)) observed.add(path);
    }
  }

  return [...observed].map((path) => normalizeToAbsolute(cwd, path));
}
