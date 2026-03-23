/**
 * read-file tool tests.
 *
 * Covers reading existing files, non-existent files,
 * line number formatting, offset/limit, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileWithLineNumbers } from '../../src/tools/read-file.js';

const TEST_DIR = join(tmpdir(), 'shipyard-read-test-' + process.pid);

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
// Reading existing files
// ---------------------------------------------------------------------------

describe('reading existing files', () => {
  it('reads a file and returns content with line numbers', async () => {
    const fp = testFile('simple.ts');
    await writeFile(fp, 'line one\nline two\nline three\n');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.total_lines).toBe(4); // trailing newline creates empty 4th element
    expect(result.content).toContain('1\tline one');
    expect(result.content).toContain('2\tline two');
    expect(result.content).toContain('3\tline three');
  });

  it('reads an empty file', async () => {
    const fp = testFile('empty.ts');
    await writeFile(fp, '');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    expect(result.total_lines).toBe(1); // split('') produces ['']
  });

  it('reads a single-line file without trailing newline', async () => {
    const fp = testFile('single.ts');
    await writeFile(fp, 'only line');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    expect(result.total_lines).toBe(1);
    expect(result.content).toContain('1\tonly line');
  });
});

// ---------------------------------------------------------------------------
// Non-existent file
// ---------------------------------------------------------------------------

describe('non-existent file', () => {
  it('returns failure with message for missing file', async () => {
    const fp = join(TEST_DIR, 'does-not-exist.ts');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(false);
    expect(result.message).toContain('File not found');
    expect(result.message).toContain('does-not-exist.ts');
  });
});

// ---------------------------------------------------------------------------
// Line number formatting
// ---------------------------------------------------------------------------

describe('line number formatting', () => {
  it('right-pads line numbers to 6 chars', async () => {
    const fp = testFile('padded.ts');
    await writeFile(fp, 'a\nb\nc\n');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    // Line number 1 padded to 6: "     1"
    const lines = result.content!.split('\n');
    expect(lines[0]).toMatch(/^\s+1\t/);
  });

  it('line numbers start at 1', async () => {
    const fp = testFile('numbering.ts');
    await writeFile(fp, 'first\nsecond\n');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    const firstLine = result.content!.split('\n')[0]!;
    expect(firstLine).toContain('1\tfirst');
  });
});

// ---------------------------------------------------------------------------
// Offset and limit
// ---------------------------------------------------------------------------

describe('offset and limit', () => {
  it('respects offset parameter', async () => {
    const fp = testFile('offset.ts');
    await writeFile(fp, 'line1\nline2\nline3\nline4\nline5\n');

    const result = await readFileWithLineNumbers({ file_path: fp, offset: 2 });

    expect(result.success).toBe(true);
    expect(result.total_lines).toBe(6); // 5 lines + trailing newline empty
    // Should start from line 3 (offset 2, 0-indexed)
    expect(result.content).toContain('3\tline3');
    expect(result.content).not.toContain('1\tline1');
    expect(result.content).not.toContain('2\tline2');
  });

  it('respects limit parameter', async () => {
    const fp = testFile('limit.ts');
    await writeFile(fp, 'a\nb\nc\nd\ne\n');

    const result = await readFileWithLineNumbers({ file_path: fp, limit: 2 });

    expect(result.success).toBe(true);
    const lines = result.content!.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('respects offset + limit together', async () => {
    const fp = testFile('both.ts');
    await writeFile(fp, 'a\nb\nc\nd\ne\n');

    const result = await readFileWithLineNumbers({ file_path: fp, offset: 1, limit: 2 });

    expect(result.success).toBe(true);
    const lines = result.content!.split('\n');
    expect(lines).toHaveLength(2);
    // Offset 1 means start from index 1 (second line = "b")
    expect(lines[0]).toContain('2\tb');
    expect(lines[1]).toContain('3\tc');
  });

  it('handles offset beyond file length', async () => {
    const fp = testFile('offset-beyond.ts');
    await writeFile(fp, 'a\nb\n');

    const result = await readFileWithLineNumbers({ file_path: fp, offset: 100 });

    expect(result.success).toBe(true);
    expect(result.content).toBe('');
    expect(result.total_lines).toBe(3);
  });

  it('handles limit larger than available lines', async () => {
    const fp = testFile('big-limit.ts');
    await writeFile(fp, 'a\nb\n');

    const result = await readFileWithLineNumbers({ file_path: fp, limit: 1000 });

    expect(result.success).toBe(true);
    expect(result.total_lines).toBe(3);
    // Should return all lines, not crash
    const lines = result.content!.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it('handles negative offset as 0', async () => {
    const fp = testFile('neg-offset.ts');
    await writeFile(fp, 'a\nb\nc\n');

    const result = await readFileWithLineNumbers({ file_path: fp, offset: -5 });

    expect(result.success).toBe(true);
    // Math.max(0, -5) = 0, so starts from beginning
    expect(result.content).toContain('1\ta');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles file with unicode content', async () => {
    const fp = testFile('unicode.ts');
    await writeFile(fp, 'const msg = "Hello World";\n');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Hello World');
  });

  it('handles file with very long lines', async () => {
    const fp = testFile('long-line.ts');
    const longLine = 'x'.repeat(10000);
    await writeFile(fp, longLine);

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    expect(result.content).toContain('x'.repeat(100));
  });

  it('handles file with mixed line endings', async () => {
    const fp = testFile('mixed.ts');
    await writeFile(fp, 'a\r\nb\nc\r\n');

    const result = await readFileWithLineNumbers({ file_path: fp });

    expect(result.success).toBe(true);
    // split('\n') handles this; \r remains in content
    expect(result.total_lines).toBeGreaterThanOrEqual(3);
  });
});
