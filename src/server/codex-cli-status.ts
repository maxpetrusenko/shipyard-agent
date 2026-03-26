import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

export interface CodexCliStatus {
  codexCliInstalled: boolean;
  codexCliAuthenticated: boolean;
  codexAuthPath: string;
}

let cached: { value: CodexCliStatus; expiresAt: number } | null = null;

function boolOverride(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return null;
}

export function getCodexCliStatus(now = Date.now()): CodexCliStatus {
  if (cached && now < cached.expiresAt) return cached.value;

  const authPath =
    process.env['CODEX_HOME']?.trim()
      ? join(process.env['CODEX_HOME']!.trim(), 'auth.json')
      : join(os.homedir(), '.codex', 'auth.json');

  const forceInstalled = boolOverride('SHIPYARD_CODEX_CLI_FORCE_INSTALLED');
  const forceAuthenticated = boolOverride('SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED');

  let installed = false;
  if (forceInstalled != null) {
    installed = forceInstalled;
  } else {
    try {
      execSync('codex --version', { stdio: 'pipe' });
      installed = true;
    } catch {
      installed = false;
    }
  }

  const authenticated = forceAuthenticated != null
    ? forceAuthenticated
    : existsSync(authPath);

  const value: CodexCliStatus = {
    codexCliInstalled: installed,
    codexCliAuthenticated: authenticated,
    codexAuthPath: authPath,
  };
  cached = { value, expiresAt: now + 30_000 };
  return value;
}

export function resetCodexCliStatusCache(): void {
  cached = null;
}

