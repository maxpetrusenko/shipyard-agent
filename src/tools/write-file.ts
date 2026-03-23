/**
 * Create or overwrite a file. Creates parent directories as needed.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface WriteFileParams {
  file_path: string;
  content: string;
}

export interface WriteFileResult {
  success: boolean;
  message: string;
}

export async function writeNewFile(
  params: WriteFileParams,
): Promise<WriteFileResult> {
  const { file_path, content } = params;

  try {
    await mkdir(dirname(file_path), { recursive: true });
    await writeFile(file_path, content, 'utf-8');
    const lineCount = content.split('\n').length;
    return {
      success: true,
      message: `Wrote ${lineCount} lines to ${file_path}`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      message: `Failed to write ${file_path}: ${(err as Error).message}`,
    };
  }
}
