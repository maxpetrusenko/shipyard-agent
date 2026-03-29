import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface IsolatedWorktree {
  worktreeDir: string;
  cleanup: () => Promise<void>;
}

function parseNullSeparated(stdout: string): string[] {
  return stdout
    .split('\0')
    .map((value) => value.trim())
    .filter(Boolean);
}

function sanitizeWorktreeSuffix(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 24) || 'worker';
}

async function gitOutput(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, ...args], {
    encoding: 'utf-8',
  });
  return stdout;
}

async function resolveRepoRoot(repoDir: string): Promise<string> {
  return (await gitOutput(repoDir, ['rev-parse', '--show-toplevel'])).trim();
}

export async function listDirtyPaths(repoDir: string): Promise<string[]> {
  const tracked = parseNullSeparated(
    await gitOutput(repoDir, ['diff', '--name-only', '-z', 'HEAD', '--']),
  );
  const untracked = parseNullSeparated(
    await gitOutput(repoDir, ['ls-files', '--others', '--exclude-standard', '-z']),
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

async function copyDirtyPath(
  baseDir: string,
  worktreeDir: string,
  relativePath: string,
): Promise<void> {
  const sourcePath = join(baseDir, relativePath);
  const targetPath = join(worktreeDir, relativePath);

  if (!existsSync(sourcePath)) {
    await rm(targetPath, { recursive: true, force: true });
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await rm(targetPath, { recursive: true, force: true });
  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
    verbatimSymlinks: true,
  });
}

async function linkSharedNodeModules(baseDir: string, worktreeDir: string): Promise<void> {
  const sourcePath = join(baseDir, 'node_modules');
  const targetPath = join(worktreeDir, 'node_modules');
  if (!existsSync(sourcePath) || existsSync(targetPath)) return;

  await mkdir(dirname(targetPath), { recursive: true });
  try {
    const symlinkTarget = await readlink(sourcePath);
    await symlink(symlinkTarget, targetPath);
  } catch {
    await symlink(sourcePath, targetPath, 'dir');
  }
}

export async function syncDirtyStateIntoWorktree(
  baseDir: string,
  worktreeDir: string,
): Promise<string[]> {
  const dirtyPaths = await listDirtyPaths(baseDir);
  for (const relativePath of dirtyPaths) {
    await copyDirtyPath(baseDir, worktreeDir, relativePath);
  }
  await linkSharedNodeModules(baseDir, worktreeDir);
  return dirtyPaths;
}

export async function createIsolatedWorktree(
  repoDir: string,
  workerId: string,
): Promise<IsolatedWorktree> {
  const repoRoot = await resolveRepoRoot(repoDir);
  const worktreeDir = await mkdtemp(
    join(tmpdir(), `shipyard-${sanitizeWorktreeSuffix(workerId)}-`),
  );

  try {
    await execFileAsync(
      'git',
      ['-C', repoRoot, 'worktree', 'add', '--detach', worktreeDir, 'HEAD'],
      { encoding: 'utf-8' },
    );
    await syncDirtyStateIntoWorktree(repoRoot, worktreeDir);
  } catch (err) {
    await rm(worktreeDir, { recursive: true, force: true });
    throw err;
  }

  return {
    worktreeDir,
    cleanup: async () => {
      try {
        await execFileAsync(
          'git',
          ['-C', repoRoot, 'worktree', 'remove', '--force', worktreeDir],
          { encoding: 'utf-8' },
        );
      } catch {
        await rm(worktreeDir, { recursive: true, force: true });
      }
      try {
        await execFileAsync('git', ['-C', repoRoot, 'worktree', 'prune'], {
          encoding: 'utf-8',
        });
      } catch {
      }
    },
  };
}
