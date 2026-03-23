import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileOverlay } from '../src/tools/file-overlay.js';

const TEST_DIR = join(tmpdir(), 'shipyard-overlay-test-' + process.pid);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

function testFile(name: string) {
  return join(TEST_DIR, name);
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

describe('snapshot', () => {
  it('captures original content before mutation', async () => {
    const fp = testFile('snap.ts');
    await writeFile(fp, 'original content');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp);

    // Mutate file on disk
    await writeFile(fp, 'mutated content');

    // Rollback restores original
    const ok = await overlay.rollbackFile(fp);
    expect(ok).toBe(true);

    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('original content');
  });

  it('only captures the first snapshot (preserves oldest original)', async () => {
    const fp = testFile('first.ts');
    await writeFile(fp, 'v1');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp);

    // Mutate, then snapshot again
    await writeFile(fp, 'v2');
    await overlay.snapshot(fp);

    // Mutate again
    await writeFile(fp, 'v3');

    await overlay.rollbackFile(fp);
    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('v1'); // v1, not v2
  });

  it('tracks newly created files', async () => {
    const fp = testFile('nonexistent.ts');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp); // File doesn't exist yet

    // Create it
    await writeFile(fp, 'created');

    // Rollback should delete it
    const ok = await overlay.rollbackFile(fp);
    expect(ok).toBe(true);

    // Verify deleted
    try {
      await readFile(fp, 'utf-8');
      expect.fail('File should have been deleted');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });
});

// ---------------------------------------------------------------------------
// rollbackFile
// ---------------------------------------------------------------------------

describe('rollbackFile', () => {
  it('returns false for untracked files', async () => {
    const overlay = new FileOverlay();
    const ok = await overlay.rollbackFile('/tmp/never-tracked.ts');
    expect(ok).toBe(false);
  });

  it('removes file from tracking after rollback', async () => {
    const fp = testFile('tracked.ts');
    await writeFile(fp, 'original');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp);

    await overlay.rollbackFile(fp);

    // Second rollback returns false (already rolled back)
    const ok = await overlay.rollbackFile(fp);
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rollbackAll
// ---------------------------------------------------------------------------

describe('rollbackAll', () => {
  it('rolls back multiple files', async () => {
    const fp1 = testFile('a.ts');
    const fp2 = testFile('b.ts');
    await writeFile(fp1, 'a-original');
    await writeFile(fp2, 'b-original');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp1);
    await overlay.snapshot(fp2);

    await writeFile(fp1, 'a-mutated');
    await writeFile(fp2, 'b-mutated');

    const rolled = await overlay.rollbackAll();
    expect(rolled).toContain(fp1);
    expect(rolled).toContain(fp2);

    expect(await readFile(fp1, 'utf-8')).toBe('a-original');
    expect(await readFile(fp2, 'utf-8')).toBe('b-original');
  });

  it('handles mix of existing and created files', async () => {
    const existing = testFile('existing.ts');
    const created = testFile('created.ts');
    await writeFile(existing, 'existing-original');

    const overlay = new FileOverlay();
    await overlay.snapshot(existing);
    await overlay.snapshot(created); // ENOENT — tracked as created

    await writeFile(existing, 'mutated');
    await writeFile(created, 'new content');

    const rolled = await overlay.rollbackAll();
    expect(rolled).toHaveLength(2);

    expect(await readFile(existing, 'utf-8')).toBe('existing-original');
    try {
      await readFile(created, 'utf-8');
      expect.fail('Created file should be deleted');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });
});

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

describe('commit', () => {
  it('discards snapshots and accepts current state', async () => {
    const fp = testFile('commit.ts');
    await writeFile(fp, 'original');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp);
    await writeFile(fp, 'mutated');

    overlay.commit();

    // Overlay is clean
    expect(overlay.dirty).toBe(false);
    expect(overlay.trackedFiles()).toEqual([]);

    // Rollback does nothing
    const ok = await overlay.rollbackFile(fp);
    expect(ok).toBe(false);

    // File stays mutated
    expect(await readFile(fp, 'utf-8')).toBe('mutated');
  });
});

// ---------------------------------------------------------------------------
// trackedFiles / dirty
// ---------------------------------------------------------------------------

describe('trackedFiles / dirty', () => {
  it('starts clean', () => {
    const overlay = new FileOverlay();
    expect(overlay.dirty).toBe(false);
    expect(overlay.trackedFiles()).toEqual([]);
  });

  it('tracks snapshotted files', async () => {
    const fp = testFile('track.ts');
    await writeFile(fp, 'content');

    const overlay = new FileOverlay();
    await overlay.snapshot(fp);

    expect(overlay.dirty).toBe(true);
    expect(overlay.trackedFiles()).toContain(fp);
  });

  it('tracks created files', async () => {
    const fp = testFile('new.ts');
    const overlay = new FileOverlay();
    await overlay.snapshot(fp); // ENOENT

    expect(overlay.dirty).toBe(true);
    expect(overlay.trackedFiles()).toContain(fp);
  });
});
