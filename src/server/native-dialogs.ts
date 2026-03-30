import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function nearestExistingDirectory(startDir?: string): string | null {
  const trimmed = startDir?.trim();
  if (!trimmed) return null;

  let current = resolve(trimmed);
  while (current && current !== dirname(current)) {
    if (existsSync(current) && statSync(current).isDirectory()) return current;
    current = dirname(current);
  }

  if (existsSync(current) && statSync(current).isDirectory()) return current;
  return null;
}

function isUserCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /user canceled|user cancelled|execution error: 128/i.test(message);
}

export function pickDirectory(startDir?: string): { cancelled: boolean; workDir?: string } {
  if (process.platform !== 'darwin') {
    throw new Error('Native directory picker is only supported on macOS.');
  }

  const defaultDir = nearestExistingDirectory(startDir);
  const script = [
    'on run argv',
    'set defaultFolder to ""',
    'if (count of argv) > 0 then',
    '  set defaultFolder to item 1 of argv',
    'end if',
    'if defaultFolder is not "" then',
    '  set chosenFolder to choose folder with prompt "Choose project folder" default location (POSIX file defaultFolder)',
    'else',
    '  set chosenFolder to choose folder with prompt "Choose project folder"',
    'end if',
    'return POSIX path of chosenFolder',
    'end run',
  ];

  try {
    const args = script.flatMap((line) => ['-e', line]);
    if (defaultDir) args.push(defaultDir);
    const picked = execFileSync('osascript', args, { encoding: 'utf-8' }).trim();
    const workDir = picked.replace(/\/+$/, '');
    return workDir ? { cancelled: false, workDir } : { cancelled: true };
  } catch (error) {
    if (isUserCancelled(error)) return { cancelled: true };
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}
