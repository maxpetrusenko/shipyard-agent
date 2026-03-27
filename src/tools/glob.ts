/**
 * File pattern matching via fast-glob.
 */

import fg from 'fast-glob';
import path from 'path';

export interface GlobParams {
  // Accept a single pattern or an array of patterns for convenience
  pattern: string | string[];
  cwd?: string;
}

export interface GlobResult {
  success: boolean;
  files: string[];
  count: number;
  // Optional error message when success is false
  message?: string;
}

export async function globSearch(params: GlobParams): Promise<GlobResult> {
  const { pattern, cwd = process.cwd() } = params;

  try {
    const files = await fg(pattern, {
      cwd,
      dot: false,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      onlyFiles: true,
    });

    // Convert to absolute paths relative to cwd and sort deterministically
    const absFiles = files.map((f) => path.resolve(cwd, f));
    absFiles.sort();

    return {
      success: true,
      files: absFiles,
      count: absFiles.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      files: [],
      count: 0,
      message: `globSearch failed: ${message}`,
    };
  }
}
