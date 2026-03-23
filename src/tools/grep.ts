/**
 * Ripgrep-backed content search.
 */

import { exec } from 'node:child_process';

export interface GrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  max_results?: number;
}

export interface GrepResult {
  success: boolean;
  matches: string;
  match_count: number;
  message?: string;
}

export function grepSearch(params: GrepParams): Promise<GrepResult> {
  const { pattern, path = '.', glob, max_results = 50 } = params;

  const args = ['rg', '--line-number', '--no-heading', '--color=never'];
  if (glob) args.push('--glob', glob);
  args.push('-m', String(max_results));
  args.push('--', pattern, path);

  const cmd = args.map((a) => (a.includes(' ') ? `'${a}'` : a)).join(' ');

  return new Promise((resolve) => {
    exec(cmd, { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
      if (error && !stdout) {
        resolve({
          success: true,
          matches: '',
          match_count: 0,
          message: 'No matches found.',
        });
        return;
      }

      const lines = stdout.trim().split('\n').filter(Boolean);
      resolve({
        success: true,
        matches: stdout.trim(),
        match_count: lines.length,
      });
    });
  });
}
