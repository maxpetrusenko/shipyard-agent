import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { renderIssuesReport } from '../../src/reporting/issues-report.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'shipyard-issues-'));
}

describe('renderIssuesReport', () => {
  it('renders seed entries and deduped observed failures', () => {
    const dir = makeDir();
    const seedPath = join(dir, 'issues.seed.json');
    try {
      writeFileSync(seedPath, JSON.stringify([
        {
          id: 'seed-1',
          symptom: 'Known conflict loop',
          rootCause: 'Coordinator bug',
          status: 'fixed',
          runs: [{ id: 'run-seed', traceUrl: 'https://example.com/seed' }],
        },
      ]));
      writeFileSync(join(dir, 'run-a.json'), JSON.stringify({
        runId: 'run-a',
        phase: 'error',
        durationMs: 10,
        error: 'Unexpected 404 from provider',
        traceUrl: 'https://example.com/run-a',
        savedAt: '2026-03-28T01:00:00.000Z',
      }));
      writeFileSync(join(dir, 'run-b.json'), JSON.stringify({
        runId: 'run-b',
        phase: 'error',
        durationMs: 10,
        error: 'Unexpected 404 from provider',
        traceUrl: 'https://example.com/run-b',
        savedAt: '2026-03-28T00:00:00.000Z',
      }));

      const markdown = renderIssuesReport(dir, seedPath, '2026-03-28T02:00:00.000Z');

      expect(markdown).toContain('Known conflict loop');
      expect(markdown).toContain('Unexpected 404 from provider');
      expect(markdown.match(/Unexpected 404 from provider/g)?.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
