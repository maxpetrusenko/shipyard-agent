/**
 * Tests for mergeCompletedSteps — preserves completed step status across replans.
 */
import { describe, it, expect } from 'vitest';
import { mergeCompletedSteps } from '../../src/graph/nodes/plan.js';
import type { PlanStep } from '../../src/graph/state.js';

function step(
  index: number,
  files: string[],
  status: PlanStep['status'] = 'pending',
  description = `Step ${index}`,
): PlanStep {
  return { index, description, files, status };
}

describe('mergeCompletedSteps', () => {
  it('returns new steps unchanged when old plan has no completed steps', () => {
    const oldSteps = [step(0, ['/a.ts'], 'pending'), step(1, ['/b.ts'], 'pending')];
    const newSteps = [step(0, ['/a.ts']), step(1, ['/b.ts'])];
    const { steps, firstPendingIndex } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
    expect(firstPendingIndex).toBe(0);
  });

  it('returns new steps unchanged when old steps is empty', () => {
    const newSteps = [step(0, ['/a.ts']), step(1, ['/b.ts'])];
    const { steps, firstPendingIndex } = mergeCompletedSteps([], newSteps);
    expect(steps).toEqual(newSteps);
    expect(firstPendingIndex).toBe(0);
  });

  it('marks new steps as done when files overlap ≥50% with completed old steps', () => {
    const oldSteps = [
      step(0, ['/a.ts', '/b.ts'], 'done'),
      step(1, ['/c.ts'], 'pending'),
    ];
    const newSteps = [
      step(0, ['/a.ts', '/b.ts', '/d.ts']), // 2/3 = 67% overlap → done
      step(1, ['/c.ts', '/e.ts']),           // no completed match
    ];
    const { steps, firstPendingIndex } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('done');
    expect(steps[1]!.status).toBe('pending');
    expect(firstPendingIndex).toBe(1);
  });

  it('does not match steps with <50% file overlap', () => {
    const oldSteps = [step(0, ['/a.ts', '/b.ts', '/c.ts', '/d.ts'], 'done')];
    const newSteps = [step(0, ['/a.ts', '/x.ts', '/y.ts', '/z.ts'])]; // 1/4 = 25%
    const { steps } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('pending');
  });

  it('keeps last step pending if all would be marked done', () => {
    const oldSteps = [
      step(0, ['/a.ts'], 'done'),
      step(1, ['/b.ts'], 'done'),
    ];
    const newSteps = [step(0, ['/a.ts']), step(1, ['/b.ts'])];
    const { steps, firstPendingIndex } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('done');
    expect(steps[1]!.status).toBe('pending'); // safety: at least one pending
    expect(firstPendingIndex).toBe(1);
  });

  it('skips steps with empty files arrays', () => {
    const oldSteps = [step(0, [], 'done')];
    const newSteps = [step(0, [])];
    const { steps, firstPendingIndex } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('pending');
    expect(firstPendingIndex).toBe(0);
  });

  it('does not double-match a single old step to multiple new steps', () => {
    const oldSteps = [step(0, ['/a.ts'], 'done')];
    const newSteps = [
      step(0, ['/a.ts']),
      step(1, ['/a.ts']),
    ];
    const { steps } = mergeCompletedSteps(oldSteps, newSteps);
    const doneCount = steps.filter((s) => s.status === 'done').length;
    expect(doneCount).toBe(1); // only first match
  });

  it('preserves new step metadata (description, files, index)', () => {
    const oldSteps = [step(0, ['/a.ts'], 'done', 'Old description'), step(1, ['/b.ts'], 'pending')];
    const newSteps = [step(0, ['/a.ts'], 'pending', 'New description'), step(1, ['/b.ts'])];
    const { steps } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.description).toBe('New description');
    expect(steps[0]!.status).toBe('done');
  });

  it('handles exact 50% overlap threshold', () => {
    const oldSteps = [step(0, ['/a.ts', '/b.ts'], 'done'), step(1, ['/c.ts'], 'pending')];
    const newSteps = [step(0, ['/a.ts', '/c.ts']), step(1, ['/d.ts'])]; // 1/2 = 50%
    const { steps } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('done');
  });

  it('handles mixed statuses in old plan (only uses done)', () => {
    const oldSteps = [
      step(0, ['/a.ts'], 'done'),
      step(1, ['/b.ts'], 'failed'),
      step(2, ['/c.ts'], 'in_progress'),
    ];
    const newSteps = [
      step(0, ['/a.ts']),
      step(1, ['/b.ts']),
      step(2, ['/c.ts']),
    ];
    const { steps } = mergeCompletedSteps(oldSteps, newSteps);
    expect(steps[0]!.status).toBe('done');
    expect(steps[1]!.status).toBe('pending'); // failed, not done
    expect(steps[2]!.status).toBe('pending'); // in_progress, not done
  });

  it('returns firstPendingIndex 0 when new steps is empty', () => {
    const { steps, firstPendingIndex } = mergeCompletedSteps(
      [step(0, ['/a.ts'], 'done')],
      [],
    );
    expect(steps).toEqual([]);
    expect(firstPendingIndex).toBe(0);
  });
});
