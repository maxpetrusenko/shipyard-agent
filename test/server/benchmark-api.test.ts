import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBenchmarkData } from '../../src/server/benchmark-api.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'shipyard-benchmark-api-'));
}

describe('buildBenchmarkData', () => {
  const prevBenchmarkDir = process.env['SHIPYARD_BENCHMARK_RESULTS_DIR'];
  const prevResultsDir = process.env['SHIPYARD_RESULTS_DIR'];

  afterEach(() => {
    if (prevBenchmarkDir === undefined) delete process.env['SHIPYARD_BENCHMARK_RESULTS_DIR'];
    else process.env['SHIPYARD_BENCHMARK_RESULTS_DIR'] = prevBenchmarkDir;
    if (prevResultsDir === undefined) delete process.env['SHIPYARD_RESULTS_DIR'];
    else process.env['SHIPYARD_RESULTS_DIR'] = prevResultsDir;
  });

  it('keeps benchmark-tagged runs and drops normal campaign runs', () => {
    const benchmarkDir = makeDir();
    const legacyDir = makeDir();
    process.env['SHIPYARD_BENCHMARK_RESULTS_DIR'] = benchmarkDir;
    process.env['SHIPYARD_RESULTS_DIR'] = legacyDir;

    try {
      writeFileSync(join(benchmarkDir, 'bench-01.json'), JSON.stringify({
        benchId: 'bench-01',
        instruction: '01-strict-typescript',
        durationMs: 120000,
        phase: 'done',
        tokenUsage: { input: 1000, output: 500 },
        filesChanged: 3,
        linesAdded: 20,
        linesRemoved: 5,
        typecheck: { before: 'pass', after: 'pass', errorDelta: 0 },
        tests: { before: { total: 10, passed: 10 }, after: { total: 10, passed: 10, failed: 0 } },
        editTiers: { tier1: 1, tier2: 1, tier3: 0, tier4: 0 },
        startedAt: '2026-03-28T00:00:00.000Z',
      }));
      writeFileSync(join(benchmarkDir, 'run-benchmark.json'), JSON.stringify({
        runId: 'run-benchmark',
        phase: 'done',
        durationMs: 90000,
        tokenUsage: { input: 900, output: 100 },
        fileEdits: [{ tier: 1, old_string: 'a', new_string: 'b' }],
        verificationResult: { passed: true, error_count: 0 },
        projectContext: { projectId: 'benchmark:bench', projectLabel: 'Benchmark Suite' },
        savedAt: '2026-03-28T00:05:00.000Z',
      }));
      writeFileSync(join(legacyDir, 'run-normal.json'), JSON.stringify({
        runId: 'run-normal',
        phase: 'done',
        durationMs: 95000,
        tokenUsage: { input: 950, output: 100 },
        fileEdits: [{ tier: 1, old_string: 'a', new_string: 'b' }],
        verificationResult: { passed: true, error_count: 0 },
        campaignId: 'regular-campaign',
        savedAt: '2026-03-28T00:06:00.000Z',
      }));

      const data = buildBenchmarkData();

      expect(data.runs.map((run) => run.runId)).toEqual(['bench-01', 'run-benchmark']);
    } finally {
      rmSync(benchmarkDir, { recursive: true, force: true });
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
