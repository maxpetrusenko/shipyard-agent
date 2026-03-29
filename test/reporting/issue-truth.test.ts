import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { updateIssueSeedFromRun } from '../../src/reporting/issue-truth.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'shipyard-issue-truth-'));
}

describe('updateIssueSeedFromRun', () => {
  it('appends run evidence and status updates to an existing seed issue', () => {
    const dir = makeDir();
    const seedPath = join(dir, 'issues.seed.json');
    try {
      writeFileSync(seedPath, JSON.stringify([
        {
          id: 'known-issue',
          symptom: 'Known issue',
          rootCause: 'Known root cause',
          status: 'open',
          patchStatus: 'open',
          testStatus: 'triage',
          benchmarkStatus: 'triage',
          runs: [],
        },
      ]));
      writeFileSync(join(dir, 'run-1.json'), JSON.stringify({
        runId: 'run-1',
        phase: 'error',
        durationMs: 12,
        error: 'Watchdog stalled',
        traceUrl: 'https://example.com/run-1',
      }));

      const out = updateIssueSeedFromRun({
        seedPath,
        resultsDir: dir,
        issueId: 'known-issue',
        runId: 'run-1',
        status: 'fixed',
        patchStatus: 'patched',
        testStatus: 'verified',
        benchmarkStatus: 'verified',
        addressed: 'Now benchmark-proven.',
      });

      expect(out.created).toBe(false);
      const updated = JSON.parse(readFileSync(seedPath, 'utf8')) as Array<Record<string, unknown>>;
      expect(updated[0]?.['status']).toBe('fixed');
      expect(updated[0]?.['benchmarkStatus']).toBe('verified');
      expect(updated[0]?.['addressed']).toBe('Now benchmark-proven.');
      expect(updated[0]?.['runs']).toEqual([
        { id: 'run-1', traceUrl: 'https://example.com/run-1' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a new seed issue from run evidence when requested', () => {
    const dir = makeDir();
    const seedPath = join(dir, 'issues.seed.json');
    try {
      writeFileSync(seedPath, '[]\n');
      writeFileSync(join(dir, 'run-2.json'), JSON.stringify({
        runId: 'run-2',
        phase: 'error',
        durationMs: 18,
        error: 'old_string matched multiple places',
        traceUrl: 'https://example.com/run-2',
        instruction: 'Harden auth middleware',
      }));

      const out = updateIssueSeedFromRun({
        seedPath,
        resultsDir: dir,
        issueId: 'new-issue',
        runId: 'run-2',
        createIfMissing: true,
      });

      expect(out.created).toBe(true);
      const updated = JSON.parse(readFileSync(seedPath, 'utf8')) as Array<Record<string, unknown>>;
      expect(updated).toHaveLength(1);
      expect(updated[0]?.['id']).toBe('new-issue');
      expect(updated[0]?.['symptom']).toBe('old_string matched multiple places');
      expect(updated[0]?.['status']).toBe('open');
      expect(updated[0]?.['runs']).toEqual([
        { id: 'run-2', traceUrl: 'https://example.com/run-2' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
