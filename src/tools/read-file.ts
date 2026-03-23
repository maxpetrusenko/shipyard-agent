/**
 * Read file with line numbers (cat -n format).
 */

import { readFile } from 'node:fs/promises';

export interface ReadFileParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface ReadFileResult {
  success: boolean;
  content?: string;
  total_lines?: number;
  message?: string;
}

export async function readFileWithLineNumbers(
  params: ReadFileParams,
): Promise<ReadFileResult> {
  const { file_path, offset = 0, limit } = params;

  let raw: string;
  try {
    raw = await readFile(file_path, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { success: false, message: `File not found: ${file_path}` };
    }
    throw err;
  }

  const allLines = raw.split('\n');
  const totalLines = allLines.length;
  const start = Math.max(0, offset);
  const end = limit ? Math.min(start + limit, totalLines) : totalLines;
  const slice = allLines.slice(start, end);

  const numbered = slice
    .map((line, i) => {
      const lineNum = String(start + i + 1).padStart(6, ' ');
      return `${lineNum}\t${line}`;
    })
    .join('\n');

  return { success: true, content: numbered, total_lines: totalLines };
}
