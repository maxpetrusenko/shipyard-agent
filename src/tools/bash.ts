/**
 * Execute a shell command with timeout.
 */

import { exec } from 'node:child_process';

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

export function runBash(params: BashParams): Promise<BashResult> {
  const { command, cwd } = params;
  const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

  return new Promise((resolve) => {
    const child = exec(
      command,
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
