import { describe, expect, it } from 'vitest';
import {
  captureRunBaseline,
  clearRunBaseline,
  detectObservedChangedFiles,
  getBaselineFingerprint,
  type BashRunner,
} from '../../src/runtime/run-baselines.js';

function ok(stdout: string) {
  return { success: true, exit_code: 0, stdout, stderr: '' };
}

describe('run baselines', () => {
  it('returns empty when no baseline exists', async () => {
    const files = await detectObservedChangedFiles('missing-run', '/repo', async () => ok(''));
    expect(files).toEqual([]);
  });

  it('detects new dirty files and committed files since baseline', async () => {
    let phase: 'capture' | 'detect' = 'capture';
    const runner: BashRunner = async ({ command }) => {
      if (command === 'git rev-parse HEAD') {
        return ok(phase === 'capture' ? 'aaa\n' : 'bbb\n');
      }
      if (command === 'git diff --name-only') {
        return ok(phase === 'capture' ? 'src/existing.ts\n' : 'src/existing.ts\nsrc/new-dirty.ts\n');
      }
      if (command === 'git diff --name-only --cached') return ok('');
      if (command === 'git ls-files --others --exclude-standard') return ok('');
      if (command === 'git diff --name-only aaa..bbb') return ok('src/from-commit.ts\n');
      return ok('');
    };

    const runId = 'run-baseline-1';
    await captureRunBaseline(runId, '/repo', runner);
    phase = 'detect';

    const files = await detectObservedChangedFiles(runId, '/repo', runner);
    expect(files).toEqual([
      '/repo/src/new-dirty.ts',
      '/repo/src/from-commit.ts',
    ]);

    clearRunBaseline(runId);
  });

  it('getBaselineFingerprint awaits capture even when called before git ops complete', async () => {
    // Simulate a slow runner where git ops take time — this exercises the race fix
    // where the deferred promise is registered synchronously before any async work.
    let gitCallCount = 0;
    const runner: BashRunner = async ({ command }) => {
      if (command === 'git rev-parse HEAD') {
        gitCallCount++;
        // Simulate slow git op
        await new Promise((r) => setTimeout(r, 50));
        return ok('abc123\n');
      }
      if (command.startsWith('git diff') || command.startsWith('git ls-files')) {
        return ok('');
      }
      // Verification commands (typecheck, lint, test)
      return { success: true, exit_code: 0, stdout: 'all good\n', stderr: '' };
    };

    const runId = 'race-test-run';
    // Fire-and-forget, just like loop.ts does
    const capturePromise = captureRunBaseline(runId, '/repo', runner);

    // Immediately call getBaselineFingerprint — should NOT return null
    // because the deferred promise was registered synchronously
    const fingerprint = await getBaselineFingerprint(runId);

    // Should have awaited the full capture
    expect(gitCallCount).toBeGreaterThan(0);
    expect(fingerprint).not.toBeNull();

    // Wait for capture to fully settle before cleanup
    await capturePromise;
    clearRunBaseline(runId);
  });

  it('getBaselineFingerprint returns null for unknown runId', async () => {
    const result = await getBaselineFingerprint('nonexistent');
    expect(result).toBeNull();
  });
});
