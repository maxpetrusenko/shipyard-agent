/**
 * Merge: detect and resolve file conflicts between worker outputs.
 */

import type { WorkerResult } from './worker.js';
import type { FileEdit } from '../graph/state.js';

export interface ConflictReport {
  filePath: string;
  workerIds: string[];
  type: 'overlapping' | 'non_overlapping';
}

/**
 * Detect file path overlap between workers.
 */
export function detectConflicts(results: WorkerResult[]): ConflictReport[] {
  const fileToWorkers = new Map<string, string[]>();

  for (const r of results) {
    for (const edit of r.fileEdits) {
      const existing = fileToWorkers.get(edit.file_path) ?? [];
      if (!existing.includes(r.subtaskId)) {
        existing.push(r.subtaskId);
      }
      fileToWorkers.set(edit.file_path, existing);
    }
  }

  const conflicts: ConflictReport[] = [];
  for (const [filePath, workerIds] of fileToWorkers) {
    if (workerIds.length > 1) {
      conflicts.push({
        filePath,
        workerIds,
        type: 'overlapping', // Conservative: assume overlapping until proven otherwise
      });
    }
  }

  return conflicts;
}

/**
 * Merge file edits from multiple workers.
 * Non-conflicting edits are applied in order.
 * Conflicting edits need supervisor re-planning.
 */
export function mergeEdits(
  results: WorkerResult[],
  conflicts: ConflictReport[],
): { merged: FileEdit[]; needsReplan: ConflictReport[] } {
  const conflictFiles = new Set(conflicts.map((c) => c.filePath));

  const merged: FileEdit[] = [];
  const needsReplan: ConflictReport[] = [];

  for (const r of results) {
    for (const edit of r.fileEdits) {
      if (conflictFiles.has(edit.file_path)) {
        const conflict = conflicts.find((c) => c.filePath === edit.file_path);
        if (conflict && !needsReplan.includes(conflict)) {
          needsReplan.push(conflict);
        }
      } else {
        merged.push(edit);
      }
    }
  }

  return { merged, needsReplan };
}
