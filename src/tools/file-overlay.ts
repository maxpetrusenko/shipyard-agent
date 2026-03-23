/**
 * Copy-on-write file overlay (pattern from vercel-labs/bash-tool OverlayFs).
 *
 * Snapshots original file contents before the first edit, enabling
 * rollback to pre-edit state when verification fails.
 */

import { readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export class FileOverlay {
  /** Maps file_path -> original content before any edits. */
  private snapshots = new Map<string, string>();

  /** Files created (didn't exist before). */
  private created = new Set<string>();

  /**
   * Snapshot the file's original content before modifying it.
   * No-op if already snapshotted (preserves the oldest original).
   */
  async snapshot(filePath: string): Promise<void> {
    if (this.snapshots.has(filePath)) return;
    try {
      const content = await readFile(filePath, 'utf-8');
      this.snapshots.set(filePath, content);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.created.add(filePath);
      }
      // Other errors: don't snapshot, rollback won't be available
    }
  }

  /**
   * Rollback a single file to its original content.
   * If the file was created during this session, deletes it.
   */
  async rollbackFile(filePath: string): Promise<boolean> {
    if (this.created.has(filePath)) {
      const { unlink } = await import('node:fs/promises');
      try {
        await unlink(filePath);
      } catch {
        // Already gone
      }
      this.created.delete(filePath);
      return true;
    }

    const original = this.snapshots.get(filePath);
    if (original === undefined) return false;

    await writeFile(filePath, original, 'utf-8');
    this.snapshots.delete(filePath);
    return true;
  }

  /**
   * Rollback all tracked files to their original state.
   * Returns the list of paths that were rolled back.
   */
  async rollbackAll(): Promise<string[]> {
    const rolled: string[] = [];
    for (const filePath of this.snapshots.keys()) {
      await this.rollbackFile(filePath);
      rolled.push(filePath);
    }
    for (const filePath of this.created) {
      await this.rollbackFile(filePath);
      rolled.push(filePath);
    }
    return rolled;
  }

  /** Commit: discard snapshots, accept current disk state. */
  commit(): void {
    this.snapshots.clear();
    this.created.clear();
  }

  /** List all files that have been snapshotted or created. */
  trackedFiles(): string[] {
    return [...this.snapshots.keys(), ...this.created];
  }

  /** Whether any files have been modified. */
  get dirty(): boolean {
    return this.snapshots.size > 0 || this.created.size > 0;
  }
}
