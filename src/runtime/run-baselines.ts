/**
 * Per-run git baselines to detect file changes made outside edit/write tools.
 */

import { isAbsolute, resolve } from 'node:path';
import { runBash, type BashResult, type BashParams } from '../tools/bash.js';

interface RunBaseline {
  head: string | null;
  dirtyFiles: Set<string>;
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

export async function captureRunBaseline(
  runId: string,
  cwd: string,
  runner: BashRunner = runBash,
): Promise<void> {
  const [head, dirtyFiles] = await Promise.all([
    readHeadSha(cwd, runner),
    readDirtyFiles(cwd, runner),
  ]);
  baselines.set(runId, { head, dirtyFiles });
}

export function clearRunBaseline(runId: string): void {
  baselines.delete(runId);
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
