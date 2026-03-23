/**
 * Execute a shell command with timeout.
 */

import { execFile } from 'node:child_process';

export interface BashParams {
  command: string;
  timeout?: number;
  cwd?: string;
}

export interface BashResult {
  success: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  message?: string;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;
const MAX_OUTPUT = 100_000;

/** Patterns that should never be run by the agent. */
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,       // rm -rf /
  /mkfs\./,              // filesystem format
  /:(){ :|:& };:/,       // fork bomb
  />\s*\/dev\/sd/,       // overwrite block device
  /\|\s*sh\b/,           // pipe into sh
  /\|\s*bash\b/,         // pipe into bash
  /curl\b.*\|\s*sh/,     // curl pipe sh
  /wget\b.*\|\s*sh/,     // wget pipe sh
];

export function runBash(params: BashParams): Promise<BashResult> {
  const { command, cwd } = params;
  const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  // Reject obviously dangerous commands
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return Promise.resolve({
        success: false,
        exit_code: 1,
        stdout: '',
        stderr: '',
        message: `Blocked: command matches dangerous pattern ${pattern.source}`,
      });
    }
  }

  return new Promise((resolve) => {
    const child = execFile(
      '/bin/sh',
      ['-c', command],
      { timeout, maxBuffer: 10 * 1024 * 1024, cwd },
      (error, stdout, stderr) => {
        const truncatedStdout =
          stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) + '\n... (truncated)'
            : stdout;
        const truncatedStderr =
          stderr.length > MAX_OUTPUT
            ? stderr.slice(0, MAX_OUTPUT) + '\n... (truncated)'
            : stderr;

        if (error) {
          const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed;
          resolve({
            success: false,
            exit_code: error.code as unknown as number ?? 1,
            stdout: truncatedStdout,
            stderr: truncatedStderr,
            message: killed ? `Command timed out after ${timeout}ms` : error.message,
          });
          return;
        }

        resolve({
          success: true,
          exit_code: child.exitCode ?? 0,
          stdout: truncatedStdout,
          stderr: truncatedStderr,
        });
      },
    );
  });
}
