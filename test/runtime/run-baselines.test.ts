import { describe, expect, it } from 'vitest';
import {
  captureRunBaseline,
  clearRunBaseline,
  detectObservedChangedFiles,
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
});
