import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createIsolatedWorktree,
  listDirtyPaths,
  syncDirtyStateIntoWorktree,
} from '../src/multi-agent/worktree.js';

function git(repoDir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8' }).trim();
}

function makeRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'shipyard-worktree-'));
  git(repoDir, 'init');
  git(repoDir, 'config', 'user.email', 'shipyard@example.com');
  git(repoDir, 'config', 'user.name', 'Shipyard Tests');
  writeFileSync(join(repoDir, 'tracked.txt'), 'base\n');
  writeFileSync(join(repoDir, 'deleted.txt'), 'remove me\n');
  git(repoDir, 'add', 'tracked.txt', 'deleted.txt');
  git(repoDir, 'commit', '-m', 'init');
  return repoDir;
}

describe('worktree isolation helpers', () => {
  it('lists tracked + untracked dirty paths', async () => {
    const repoDir = makeRepo();
    try {
      writeFileSync(join(repoDir, 'tracked.txt'), 'changed\n');
      writeFileSync(join(repoDir, 'new.txt'), 'new\n');
      rmSync(join(repoDir, 'deleted.txt'));

      const paths = await listDirtyPaths(repoDir);
      expect(paths).toEqual(['deleted.txt', 'new.txt', 'tracked.txt']);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('syncs dirty state into detached worktree and cleans it up', async () => {
    const repoDir = makeRepo();
    mkdirSync(join(repoDir, 'node_modules'));
    writeFileSync(join(repoDir, 'node_modules', 'marker.txt'), 'shared\n');

    try {
      writeFileSync(join(repoDir, 'tracked.txt'), 'changed\n');
      writeFileSync(join(repoDir, 'new.txt'), 'new\n');
      rmSync(join(repoDir, 'deleted.txt'));

      const isolated = await createIsolatedWorktree(repoDir, 'worker-1');
      try {
        await syncDirtyStateIntoWorktree(repoDir, isolated.worktreeDir);
        expect(readFileSync(join(isolated.worktreeDir, 'tracked.txt'), 'utf-8')).toBe('changed\n');
        expect(readFileSync(join(isolated.worktreeDir, 'new.txt'), 'utf-8')).toBe('new\n');
        expect(() => readFileSync(join(isolated.worktreeDir, 'deleted.txt'), 'utf-8')).toThrow();
        expect(readFileSync(join(isolated.worktreeDir, 'node_modules', 'marker.txt'), 'utf-8')).toBe('shared\n');
      } finally {
        const worktreeDir = isolated.worktreeDir;
        await isolated.cleanup();
        expect(git(repoDir, 'worktree', 'list')).not.toContain(worktreeDir);
      }
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
