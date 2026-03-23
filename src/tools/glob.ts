/**
 * File pattern matching via fast-glob.
 */

import fg from 'fast-glob';

export interface GlobParams {
  pattern: string;
  cwd?: string;
}

export interface GlobResult {
  success: boolean;
  files: string[];
  count: number;
}

export async function globSearch(params: GlobParams): Promise<GlobResult> {
  const { pattern, cwd = '.' } = params;

  const files = await fg(pattern, {
    cwd,
    dot: false,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    onlyFiles: true,
  });

  files.sort();

  return {
    success: true,
    files,
    count: files.length,
  };
}
