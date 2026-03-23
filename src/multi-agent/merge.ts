/**
 * Merge: detect and resolve file conflicts between worker outputs.
 *
 * Two levels of conflict detection:
 * 1. File-level: multiple workers touched the same file
 * 2. Region-level: edits to the same file overlap in old_string content
 *
 * Non-overlapping edits to the same file (e.g., different functions) are
 * merged safely. True overlaps are flagged for replan.
 */

import type { WorkerResult } from './worker.js';
import type { FileEdit } from '../graph/state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictReport {
  filePath: string;
  workerIds: string[];
  type: 'overlapping' | 'non_overlapping';
  /** Which specific edits conflict (indices into the flat edit list). */
  editIndices?: number[];
}

interface TaggedEdit {
  edit: FileEdit;
  workerId: string;
  index: number;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Detect file-level and region-level conflicts between worker outputs.
 *
 * File-level: multiple workers edited the same file_path.
 * Region-level: two edits to the same file share overlapping old_string
 * content (one old_string is a substring of the other, or they share a
 * common line).
 */
export function detectConflicts(results: WorkerResult[]): ConflictReport[] {
  // Group edits by file path
  const fileToEdits = new Map<string, TaggedEdit[]>();
  let globalIdx = 0;

  for (const r of results) {
    for (const edit of r.fileEdits) {
      const existing = fileToEdits.get(edit.file_path) ?? [];
      existing.push({ edit, workerId: r.subtaskId, index: globalIdx++ });
      fileToEdits.set(edit.file_path, existing);
    }
  }

  const conflicts: ConflictReport[] = [];

  for (const [filePath, edits] of fileToEdits) {
    // Only one worker touched this file — no conflict
    const uniqueWorkers = [...new Set(edits.map((e) => e.workerId))];
    if (uniqueWorkers.length <= 1) continue;

    // Check region-level overlap between edits from different workers
    const overlappingIndices: number[] = [];
    let hasOverlap = false;

    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        const a = edits[i]!;
        const b = edits[j]!;

        // Only check cross-worker pairs
        if (a.workerId === b.workerId) continue;

        if (editsOverlap(a.edit, b.edit)) {
          hasOverlap = true;
          if (!overlappingIndices.includes(a.index)) overlappingIndices.push(a.index);
          if (!overlappingIndices.includes(b.index)) overlappingIndices.push(b.index);
        }
      }
    }

    conflicts.push({
      filePath,
      workerIds: uniqueWorkers,
      type: hasOverlap ? 'overlapping' : 'non_overlapping',
      editIndices: hasOverlap ? overlappingIndices : undefined,
    });
  }

  return conflicts;
}

/**
 * Check whether two edits to the same file overlap.
 *
 * Overlap heuristics:
 * 1. Substring containment: one old_string contains the other
 * 2. Shared lines: any line appears in both old_strings
 */
function editsOverlap(a: FileEdit, b: FileEdit): boolean {
  // Substring containment
  if (a.old_string.includes(b.old_string) || b.old_string.includes(a.old_string)) {
    return true;
  }

  // Shared line check (non-empty lines only)
  const aLines = new Set(
    a.old_string.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
  );
  const bLines = b.old_string.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  for (const line of bLines) {
    if (aLines.has(line)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge file edits from multiple workers.
 *
 * Strategy:
 * - Non-overlapping edits (even to the same file) are merged safely.
 * - Overlapping edits: keep the first worker's edit, flag the rest for replan.
 * - Edits to files only touched by one worker are always kept.
 */
export function mergeEdits(
  results: WorkerResult[],
  conflicts: ConflictReport[],
): { merged: FileEdit[]; needsReplan: ConflictReport[] } {
  // Build a set of truly overlapping file paths
  const overlappingFiles = new Set(
    conflicts
      .filter((c) => c.type === 'overlapping')
      .map((c) => c.filePath),
  );

  // Build set of edit indices that are conflicting
  const conflictingIndices = new Set<number>();
  for (const c of conflicts) {
    if (c.type === 'overlapping' && c.editIndices) {
      for (const idx of c.editIndices) {
        conflictingIndices.add(idx);
      }
    }
  }

  const merged: FileEdit[] = [];
  const needsReplan: ConflictReport[] = [];
  let globalIdx = 0;

  // Track which overlapping files already have a "winner" worker
  const overlappingFileWinner = new Map<string, string>();

  for (const r of results) {
    for (const edit of r.fileEdits) {
      const idx = globalIdx++;

      if (overlappingFiles.has(edit.file_path)) {
        // For overlapping files, keep first worker's edits only
        const existingWinner = overlappingFileWinner.get(edit.file_path);
        if (!existingWinner) {
          // First worker to claim this file wins
          overlappingFileWinner.set(edit.file_path, r.subtaskId);
          merged.push(edit);
        } else if (existingWinner === r.subtaskId) {
          // Same worker — keep
          merged.push(edit);
        }
        // else: different worker on overlapping file — skip (handled by replan)
      } else {
        // Non-overlapping or single-worker file — keep
        merged.push(edit);
      }
    }
  }

  // Collect the conflicts that need replanning
  for (const c of conflicts) {
    if (c.type === 'overlapping') {
      needsReplan.push(c);
    }
  }

  return { merged, needsReplan };
}
