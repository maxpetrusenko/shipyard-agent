import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('../../', import.meta.url).pathname);

export const BENCHMARK_PROJECT_ID_PREFIX = 'benchmark:';
export const DEFAULT_RESULTS_DIR = resolve(REPO_ROOT, 'results');
export const DEFAULT_BENCHMARK_RESULTS_DIR = resolve(DEFAULT_RESULTS_DIR, 'benchmarks');

function cleanDir(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? resolve(trimmed) : null;
}

export function resolveBenchmarkResultsDirs(): string[] {
  const explicitBenchmarkDir = cleanDir(process.env['SHIPYARD_BENCHMARK_RESULTS_DIR']);
  const explicitResultsDir = cleanDir(process.env['SHIPYARD_RESULTS_DIR']);
  const dirs = explicitBenchmarkDir
    ? [explicitBenchmarkDir, explicitResultsDir]
    : [DEFAULT_BENCHMARK_RESULTS_DIR, explicitResultsDir, DEFAULT_RESULTS_DIR];
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    resolved.push(dir);
  }
  return resolved;
}

export function hasBenchmarkProjectContext(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const projectId = (value as { projectId?: unknown }).projectId;
  return typeof projectId === 'string' && projectId.startsWith(BENCHMARK_PROJECT_ID_PREFIX);
}
