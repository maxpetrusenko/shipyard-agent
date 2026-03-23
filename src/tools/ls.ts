/**
 * Directory listing with file type indicators.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface LsParams {
  path: string;
}

export interface LsEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

export interface LsResult {
  success: boolean;
  entries: LsEntry[];
  message?: string;
}

export async function listDirectory(params: LsParams): Promise<LsResult> {
  const { path } = params;

  try {
    const names = await readdir(path);
    const entries: LsEntry[] = [];

    for (const name of names) {
      if (name.startsWith('.')) continue;
      try {
        const info = await stat(join(path, name));
        entries.push({
          name,
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.size,
        });
      } catch {
        // Skip inaccessible entries
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, entries };
  } catch (err: unknown) {
    return {
      success: false,
      entries: [],
      message: `Failed to list directory: ${(err as Error).message}`,
    };
  }
}
