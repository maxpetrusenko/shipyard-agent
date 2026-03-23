import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editFile } from '../src/tools/edit-file.js';

const TEST_DIR = join(tmpdir(), 'shipyard-edit-test-' + process.pid);

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
// Tier 1: Exact match
// ---------------------------------------------------------------------------

describe('Tier 1: Exact match', () => {
  it('replaces a unique string', async () => {
    const fp = testFile('exact.ts');
    await writeFile(fp, 'const x = 1;\nconst y = 2;\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'const x = 1;',
      new_string: 'const x = 42;',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    expect(result.diff_preview).toContain('- const x = 1;');
    expect(result.diff_preview).toContain('+ const x = 42;');

    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('const x = 42;\nconst y = 2;\n');
  });

  it('rejects multiple matches with count', async () => {
    const fp = testFile('multi.ts');
    await writeFile(fp, 'foo\nbar\nfoo\nbaz\nfoo\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'foo',
      new_string: 'qux',
    });

    expect(result.success).toBe(false);
    expect(result.tier).toBe(1);
    expect(result.message).toContain('3 times');
  });

  it('rejects identical old_string and new_string', async () => {
    const fp = testFile('same.ts');
    await writeFile(fp, 'hello world');

    const result = await editFile({
      file_path: fp,
      old_string: 'hello',
      new_string: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('identical');
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Whitespace-normalized
// ---------------------------------------------------------------------------

describe('Tier 2: Whitespace-normalized match', () => {
  it('matches despite leading/trailing whitespace differences', async () => {
    const fp = testFile('ws.ts');
    await writeFile(fp, '  const  x  =  1;  \n  const  y  =  2;  \n');

    const result = await editFile({
      file_path: fp,
      old_string: 'const x = 1;',
      new_string: 'const x = 42;',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(2);

    const content = await readFile(fp, 'utf-8');
    expect(content).toContain('const x = 42;');
  });

  it('matches multi-line blocks with whitespace differences', async () => {
    const fp = testFile('wsml.ts');
    await writeFile(fp, '  if (true) {\n    return  1;\n  }\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'if (true) {\n  return 1;\n}',
      new_string: 'if (false) {\n  return 0;\n}',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: Fuzzy match (Levenshtein)
// ---------------------------------------------------------------------------

describe('Tier 3: Fuzzy match', () => {
  it('matches with small typo (within 10% distance)', async () => {
    const fp = testFile('fuzzy.ts');
    // "export function handleRequest" (28 chars). A 2-char change is within 10%.
    await writeFile(fp, 'export function handleReqeust(req: Request) {\n  return null;\n}\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'export function handleRequest(req: Request) {\n  return null;\n}',
      new_string: 'export function handleRequest(req: Request) {\n  return "ok";\n}',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(3);
    expect(result.message).toContain('Fuzzy');
  });
});

// ---------------------------------------------------------------------------
// Tier 4: Full rewrite
// ---------------------------------------------------------------------------

describe('Tier 4: Full rewrite', () => {
  it('falls through to full rewrite when nothing matches', async () => {
    const fp = testFile('rewrite.ts');
    await writeFile(fp, 'completely different content here\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'this text does not exist anywhere in the file at all whatsoever',
      new_string: 'new file content\nline two\n',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(4);
    expect(result.message).toContain('Full file rewrite');

    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('new file content\nline two\n');
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('creates file when it does not exist (tier 4)', async () => {
    const result = await editFile({
      file_path: join(TEST_DIR, 'nonexistent.ts'),
      old_string: 'foo',
      new_string: 'bar',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(4);
    expect(result.message).toContain('File not found');
    const content = await readFile(join(TEST_DIR, 'nonexistent.ts'), 'utf-8');
    expect(content).toBe('bar');
  });

  it('rejects empty old_string', async () => {
    const fp = testFile('empty-guard.ts');
    await writeFile(fp, 'some content');

    const result = await editFile({
      file_path: fp,
      old_string: '',
      new_string: 'replacement',
    });

    expect(result.success).toBe(false);
    expect(result.tier).toBe(1);
    expect(result.message).toContain('old_string cannot be empty');
  });

  it('rejects whitespace-only old_string', async () => {
    const fp = testFile('ws-guard.ts');
    await writeFile(fp, 'some content');

    const result = await editFile({
      file_path: fp,
      old_string: '   \n  ',
      new_string: 'replacement',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('old_string cannot be empty');
  });

  it('creates parent dirs on tier-4 rewrite', async () => {
    const fp = join(TEST_DIR, 'deep', 'nested', 'file.ts');

    const result = await editFile({
      file_path: fp,
      old_string: 'nonexistent content',
      new_string: 'created content\n',
    });

    // File doesn't exist -> falls through to tier 4 rewrite
    expect(result.success).toBe(true);
    expect(result.tier).toBe(4);

    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('created content\n');
  });
});
