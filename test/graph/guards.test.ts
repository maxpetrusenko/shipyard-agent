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

  it('does not require edits for "describe" prefixed instructions', () => {
    expect(shouldRequireEdits('Describe how the auth system works')).toBe(false);
  });

  it('does not require edits for "how do I" questions', () => {
    expect(shouldRequireEdits('How do I add a new endpoint?')).toBe(false);
  });

  it('does not require edits for "what is" questions', () => {
    expect(shouldRequireEdits('What is the purpose of this module?')).toBe(false);
  });

  it('requires edits when informational prefix combined with imperative edit verb', () => {
    expect(shouldRequireEdits('Explain the auth flow and then fix the login bug')).toBe(true);
  });

  it('requires edits for "document" with explicit file path', () => {
    expect(shouldRequireEdits('Document the public API in README.md')).toBe(true);
  });

  it('requires edits for "review and update" instructions', () => {
    expect(shouldRequireEdits('Review this file and update the docs')).toBe(true);
  });

  it('does not require edits for purely informational review', () => {
    // No edit verb — just "review" with no action words
    expect(shouldRequireEdits('Review the code quality of this file')).toBe(false);
  });

  it('requires edits for "please add" style instructions', () => {
    expect(shouldRequireEdits('Please add a logout button')).toBe(true);
  });

  it('requires edits for create/write/remove verbs', () => {
    expect(shouldRequireEdits('Create a new test file for auth')).toBe(true);
    expect(shouldRequireEdits('Remove the deprecated function')).toBe(true);
    expect(shouldRequireEdits('Write a helper for date parsing')).toBe(true);
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
    expect(ms).toBe(120_000);
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

  it('allows canonical db counterpart when step targets legacy src/db path', () => {
    const out = evaluateCandidateEditPath({
      instruction:
        'Create the canonical deliverable under /repo/api/db and preserve wrappers under /repo/api/src/db.',
      steps: [
        {
          index: 0,
          description: 'migrate orphan helper',
          files: ['/repo/api/src/db/scripts/orphan-diagnostic.ts'],
          status: 'pending',
        },
      ],
      editedPaths: [],
      candidatePath: '/repo/api/db/scripts/orphan-diagnostic.ts',
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

  it('extracts repo basename from explicit path target', () => {
    const target = extractExplicitRepoTarget(
      'build ship app in desktop/gauntlet/ship2. here is plan',
    );
    expect(target).toBe('ship2');
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

  it('detects mismatch when instruction targets a repo path', () => {
    const mismatch = detectRepoTargetMismatch(
      'build ship app in desktop/gauntlet/ship2. here is plan',
      '/Users/max/Desktop/Gauntlet/ship-agent',
    );
    expect(mismatch).toEqual({
      targetRepo: 'ship2',
      activeRepo: 'ship-agent',
    });
  });
});

// ---------------------------------------------------------------------------
// Regression tests for known failure classes
// ---------------------------------------------------------------------------

describe('failure class regressions', () => {
  it('scope guard allows instruction-mentioned files even if planner omits them', () => {
    // Failure class: "Edited files outside planned scope" (run 8d8aa0da)
    // Root cause: planner only listed routes/ files in steps, not src/services/
    const result = evaluateScopeGuard({
      instruction: 'Create routes/files.ts and src/services/upload.ts and src/services/uploadTracker.ts',
      fileEdits: [
        { file_path: '/repo/routes/files.ts', tier: 1, old_string: '', new_string: 'x', timestamp: 0 },
        { file_path: '/repo/src/services/upload.ts', tier: 1, old_string: '', new_string: 'x', timestamp: 0 },
        { file_path: '/repo/src/services/uploadTracker.ts', tier: 1, old_string: '', new_string: 'x', timestamp: 0 },
      ],
      steps: [
        { index: 0, description: 'Create routes', files: ['routes/files.ts'], status: 'done' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('extension list .exe/.bat/.sh is NOT parsed as file paths', () => {
    // Failure class: discovery limit 14/8 (run 71f0cdaf)
    const constraints = deriveScopeConstraints(
      'blocks dangerous extensions like .exe/.bat/.sh/.dll/.jar/.ps1',
    );
    expect(constraints.explicitFiles.length).toBe(0);
    expect(constraints.strictSingleFile).toBe(false);
  });

  it('first-edit deadline is at least 120s for scoped instructions', () => {
    // Failure class: first edit deadline exceeded 52s > 45s (run 09fcf7fe)
    const singleFile = deriveFirstEditDeadlineMs('Fix only src/foo.ts');
    expect(singleFile).toBeGreaterThanOrEqual(120_000);

    const multiFile = deriveFirstEditDeadlineMs(
      'Create routes/files.ts and src/services/upload.ts',
    );
    expect(multiFile).toBeGreaterThanOrEqual(150_000);
  });

  it('non-scoped edit instructions get a fallback deadline', () => {
    // Previously null = no deadline; agent could explore forever
    const deadline = deriveFirstEditDeadlineMs('Implement file uploads and comments for Ship.');
    expect(deadline).not.toBeNull();
    expect(deadline).toBeGreaterThanOrEqual(120_000);
  });
});
