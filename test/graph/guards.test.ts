import { describe, expect, it } from 'vitest';
import {
  deriveScopeConstraints,
  evaluateScopeGuard,
  shouldRequireEdits,
} from '../../src/graph/guards.js';

describe('deriveScopeConstraints', () => {
  it('detects strict single-file constraints', () => {
    const c = deriveScopeConstraints(
      'Make exactly one file change. Do not edit any other file.',
    );
    expect(c.strictSingleFile).toBe(true);
    expect(c.disallowUnrelatedFiles).toBe(true);
  });

  it('extracts explicit file targets from instruction text', () => {
    const c = deriveScopeConstraints(
      'Only update scripts/check-empty-tests.sh and docs/notes.md',
    );
    expect(c.explicitFiles).toContain('scripts/check-empty-tests.sh');
    expect(c.explicitFiles).toContain('docs/notes.md');
  });
});

describe('evaluateScopeGuard', () => {
  it('fails when strict single-file instruction edits multiple files', () => {
    const out = evaluateScopeGuard({
      instruction:
        'In this repo make exactly one file change, keep to one file only.',
      steps: [],
      fileEdits: [
        { file_path: '/repo/a.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 },
        { file_path: '/repo/b.ts', tier: 1, old_string: 'x', new_string: 'y', timestamp: 2 },
      ],
    } as any);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('exactly one file');
  });

  it('fails when edits are outside explicit file target', () => {
    const out = evaluateScopeGuard({
      instruction: 'Only edit scripts/check-empty-tests.sh',
      steps: [],
      fileEdits: [
        { file_path: '/repo/other.ts', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 },
      ],
    } as any);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('outside explicit targets');
  });

  it('passes when one edited file matches explicit target', () => {
    const out = evaluateScopeGuard({
      instruction: 'Only edit scripts/check-empty-tests.sh and no unrelated files.',
      steps: [],
      fileEdits: [
        { file_path: '/repo/scripts/check-empty-tests.sh', tier: 1, old_string: 'a', new_string: 'b', timestamp: 1 },
      ],
    } as any);
    expect(out.ok).toBe(true);
  });
});

describe('shouldRequireEdits', () => {
  it('requires edits for explicit change instructions', () => {
    expect(shouldRequireEdits('Please fix this bug in parser.ts')).toBe(true);
  });

  it('does not require edits for informational asks', () => {
    expect(shouldRequireEdits('Explain how this module works')).toBe(false);
  });
});
