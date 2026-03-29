import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { renderBenchmarksReport } from '../../src/reporting/benchmarks-report.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'shipyard-benchmarks-'));
}

describe('renderBenchmarksReport', () => {
  it('renders rebuild progress and recent rows', () => {
    const dir = makeDir();
    try {
      writeFileSync(join(dir, 'bench-03.json'), JSON.stringify({
        benchId: 'bench-03',
        instruction: '03-database-schema-and-migrations',
        phase: 'done',
        durationMs: 120000,
        peakRssKb: 262144,
        tokenUsage: { input: 1000, output: 500 },
        filesChanged: 7,
        editToolCalls: 11,
        traceUrl: 'https://example.com/trace/03',
        startedAt: '2026-03-28T00:00:00.000Z',
        completedAt: '2026-03-28T00:02:00.000Z',
      }));
      writeFileSync(join(dir, 'bench-03-newer-failed.json'), JSON.stringify({
        benchId: 'bench-03-newer-failed',
        instruction: '03-database-schema-and-migrations',
        phase: 'error',
        durationMs: 30000,
        peakRssKb: 131072,
        tokenUsage: { input: 200, output: 100 },
        filesChanged: 1,
        editToolCalls: 1,
        error: 'newer failure',
        traceUrl: 'https://example.com/trace/03-failed',
        startedAt: '2026-03-28T02:05:00.000Z',
        completedAt: '2026-03-28T02:05:30.000Z',
      }));
      writeFileSync(join(dir, 'run-1.json'), JSON.stringify({
        runId: 'run-1',
        phase: 'error',
        durationMs: 10000,
        tokenUsage: { input: 100, output: 25 },
        fileEdits: [{ tier: 1 }],
        toolCallHistory: [
          { tool_name: 'read_file', tool_result: '{"success":true}' },
          { tool_name: 'edit_file', tool_result: '{"success":false}' },
          { tool_name: 'edit_file', tool_result: '{"success":true}' },
          { tool_name: 'write_file', tool_result: '{"success":true}' },
        ],
        error: 'Example failure',
        traceUrl: 'https://example.com/run/1',
        savedAt: '2026-03-28T01:00:00.000Z',
        projectContext: { projectId: 'benchmark:rebuild', projectLabel: 'Benchmark Rebuild' },
        messages: [{ role: 'user', content: 'Fix auth middleware' }],
      }));
      writeFileSync(join(dir, 'run-2.json'), JSON.stringify({
        runId: 'run-2',
        phase: 'error',
        durationMs: 12000,
        tokenUsage: { input: 120, output: 35 },
        fileEdits: [{ tier: 1 }],
        error: 'Should stay out of benchmark swarm rows',
        traceUrl: 'https://example.com/run/2',
        campaignId: 'normal-campaign',
        savedAt: '2026-03-28T01:10:00.000Z',
        messages: [{ role: 'user', content: 'Normal dashboard run' }],
      }));
      writeFileSync(join(dir, 'snapshot-rebuild-final.json'), JSON.stringify({
        type: 'snapshot',
        label: 'rebuild-final',
        timestamp: '2026-03-28T01:30:00.000Z',
        path: '/tmp/ship-rebuild',
        typecheck: { status: 'fail', errors: 4 },
        build: { status: 'pass', durationMs: 12000 },
        tests: { total: 58, passed: 57, failed: 1 },
        security: { vulnerabilities: 0 },
        loc: 0,
        files: 0,
        buildDurationMs: 12000,
      }));

      const markdown = renderBenchmarksReport(dir, '2026-03-28T02:00:00.000Z');

      expect(markdown).toContain('Generated: 2026-03-27 21:00:00 CT');
      expect(markdown).toContain('Time zone: Texas (CT)');
      expect(markdown).toContain('Best verified completion: 1/7 steps (14%)');
      expect(markdown).toContain('Latest rebuild integration: fail (typecheck=fail, build=pass, tests=57/58)');
      expect(markdown).toContain('Best verified rebuild step evidence: persisted step-level run at 2026-03-27 19:02:00 CT');
      expect(markdown).toContain('Latest rebuild step evidence: persisted step-level run at 2026-03-27 21:05:30 CT');
      expect(markdown).toContain('Database Schema And Migrations');
      expect(markdown).toContain('2026-03-27 19:02:00 CT');
      expect(markdown).toContain('256 MB');
      expect(markdown).toContain('## Best Verified Rebuild Steps');
      expect(markdown).toContain('## Latest Rebuild Attempts');
      expect(markdown).toContain('## Rebuild Final Gates');
      expect(markdown).toContain('| Database Schema And Migrations | done | 2026-03-27 19:00:00 CT | 2026-03-27 19:02:00 CT | 2m 0s | 256 MB | 1500 | 11 | none | [trace](https://example.com/trace/03) |');
      expect(markdown).toContain('| Database Schema And Migrations | error | 2026-03-27 21:05:00 CT | 2026-03-27 21:05:30 CT | 30s | 128 MB | 300 | 1 | newer failure | [trace](https://example.com/trace/03-failed) |');
      expect(markdown).toContain('| 2026-03-27 20:30:00 CT | fail | fail | pass | 57/58 | 4 | 12s |');
      expect(markdown).toContain('| Fix auth middleware | error | — | 2026-03-27 20:00:00 CT | 10s | — | 125 | 3 | Example failure | [trace](https://example.com/run/1) |');
      expect(markdown).toContain('Fix auth middleware');
      expect(markdown).toContain('Example failure');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
