import { describe, expect, it } from 'vitest';
import {
  constrainPlanStepsToScope,
  detectRepoTargetMismatch,
  deriveDiscoveryCallLimit,
  deriveFirstEditDeadlineMs,
  deriveScopeConstraints,
  evaluateCandidateEditPath,
  evaluateScopeGuard,
  extractExplicitRepoTarget,
  isDiscoveryToolName,
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

  it('treats a single explicit file path as hard single-file scope', () => {
    const c = deriveScopeConstraints(
      'Update /repo/CONTRIBUTING.md to include Hello world.',
    );
    expect(c.strictSingleFile).toBe(true);
    expect(c.disallowUnrelatedFiles).toBe(true);
    expect(c.explicitFiles).toEqual(['/repo/CONTRIBUTING.md']);
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

describe('discovery and deadline guardrails', () => {
  it('parses explicit discovery-call limit from instruction', () => {
    const limit = deriveDiscoveryCallLimit(
      'Avoid drift. Max 8 discovery tool calls before first edit.',
    );
    expect(limit).toBe(8);
  });

  it('applies stricter default first-edit deadline for single-file prompts', () => {
    const ms = deriveFirstEditDeadlineMs('Make exactly one file change only.');
    expect(ms).toBe(75_000);
  });

  it('parses explicit first-edit deadline override', () => {
    const ms = deriveFirstEditDeadlineMs(
      'Critical: first-edit deadline 45s, do not drift.',
    );
    expect(ms).toBe(45_000);
  });

  it('identifies discovery tools', () => {
    expect(isDiscoveryToolName('read_file')).toBe(true);
    expect(isDiscoveryToolName('edit_file')).toBe(false);
  });
});

describe('evaluateCandidateEditPath', () => {
  it('blocks edits outside explicit target', () => {
    const out = evaluateCandidateEditPath({
      instruction: 'Only edit src/a.ts',
      steps: [],
      editedPaths: [],
      candidatePath: '/repo/src/b.ts',
    });
    expect(out.ok).toBe(false);
  });

  it('allows first edit within explicit target', () => {
    const out = evaluateCandidateEditPath({
      instruction: 'Only edit src/a.ts',
      steps: [],
      editedPaths: [],
      candidatePath: '/repo/src/a.ts',
    });
    expect(out.ok).toBe(true);
  });
});

describe('constrainPlanStepsToScope', () => {
  it('drops unrelated planned files when the instruction pins an explicit file target', () => {
    const out = constrainPlanStepsToScope(
      'Update /repo/CONTRIBUTING.md to include Hello world.',
      [
        {
          index: 0,
          description: 'edit target',
          files: ['/repo/CONTRIBUTING.md'],
          status: 'pending',
        },
        {
          index: 1,
          description: 'wrong extra step',
          files: ['/repo/web/src/pages/MyWeekPage.tsx'],
          status: 'pending',
        },
      ],
    );

    expect(out).toEqual([
      {
        index: 0,
        description: 'edit target',
        files: ['/repo/CONTRIBUTING.md'],
        status: 'pending',
      },
    ]);
  });

  it('falls back to the explicit target when the drafted plan misses it entirely', () => {
    const out = constrainPlanStepsToScope(
      'Update /repo/CONTRIBUTING.md to include Hello world.',
      [
        {
          index: 0,
          description: 'wrong extra step',
          files: ['/repo/web/src/pages/MyWeekPage.tsx'],
          status: 'pending',
        },
      ],
    );

    expect(out).toEqual([
      {
        index: 0,
        description: 'Update /repo/CONTRIBUTING.md to include Hello world.',
        files: ['/repo/CONTRIBUTING.md'],
        status: 'pending',
      },
    ]);
  });
});

describe('repo target guards', () => {
  it('extracts explicit repo target from instruction prefix', () => {
    const target = extractExplicitRepoTarget(
      'In ship-refactored, make exactly one minimal bugfix.',
    );
    expect(target).toBe('ship-refactored');
  });

  it('detects mismatch between instruction target and active repo', () => {
    const mismatch = detectRepoTargetMismatch(
      'In ship-refactored, make exactly one minimal bugfix.',
      '/Users/max/Desktop/Gauntlet/ship-agent',
    );
    expect(mismatch).toEqual({
      targetRepo: 'ship-refactored',
      activeRepo: 'ship-agent',
    });
  });

  it('does not flag mismatch when repo target matches active repo', () => {
    const mismatch = detectRepoTargetMismatch(
      'In ship-agent, patch one file.',
      '/Users/max/Desktop/Gauntlet/ship-agent',
    );
    expect(mismatch).toBeNull();
  });
});
