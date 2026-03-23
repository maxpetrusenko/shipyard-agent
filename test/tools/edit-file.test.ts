/**
 * Extended edit-file tests covering all 4 tiers + edge cases.
 *
 * The root test/edit-file.test.ts covers the core behavior; this file
 * adds deeper coverage for corner cases and multi-line scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { editFile } from '../../src/tools/edit-file.js';

const TEST_DIR = join(tmpdir(), 'shipyard-edit-ext-' + process.pid);

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
// Tier 1 extended
// ---------------------------------------------------------------------------

describe('Tier 1 extended', () => {
  it('handles multi-line exact match', async () => {
    const fp = testFile('ml.ts');
    await writeFile(fp, 'function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'function foo() {\n  return 1;\n}',
      new_string: 'function foo() {\n  return 42;\n}',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    const content = await readFile(fp, 'utf-8');
    expect(content).toContain('return 42;');
    expect(content).toContain('return 2;');
  });

  it('preserves surrounding content on replacement', async () => {
    const fp = testFile('surround.ts');
    await writeFile(fp, 'AAA\nBBB\nCCC\nDDD\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'BBB\nCCC',
      new_string: 'XXX\nYYY',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('AAA\nXXX\nYYY\nDDD\n');
  });

  it('correctly counts 2 matches as multiple', async () => {
    const fp = testFile('two.ts');
    await writeFile(fp, 'alpha\nbeta\nalpha\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'alpha',
      new_string: 'gamma',
    });

    expect(result.success).toBe(false);
    expect(result.tier).toBe(1);
    expect(result.message).toContain('2 times');
  });
});

// ---------------------------------------------------------------------------
// Tier 2 extended
// ---------------------------------------------------------------------------

describe('Tier 2 extended', () => {
  it('normalizes tabs vs spaces in multi-line block', async () => {
    const fp = testFile('tabs.ts');
    // File has tab indentation with extra spaces
    await writeFile(fp, '\tif  (true) {\n\t\treturn   1;\n\t}\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'if (true) {\n  return 1;\n}',
      new_string: 'if (false) {\n  return 0;\n}',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(2);
  });

  it('rejects multiple whitespace-normalized matches', async () => {
    const fp = testFile('wsmulti.ts');
    await writeFile(fp, '  const x = 1;\n  const x = 1;\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'const x = 1;',
      new_string: 'const x = 99;',
    });

    // Multiple normalized matches -> should fail (no unique match)
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tier 3 extended
// ---------------------------------------------------------------------------

describe('Tier 3 extended', () => {
  it('does not match when distance exceeds 10% threshold', async () => {
    const fp = testFile('nofuzzy.ts');
    await writeFile(fp, 'completely different content that is totally unrelated\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'absolutely nothing similar here at all whatsoever oh no',
      new_string: 'replacement',
    });

    // Falls through to tier 4 since no fuzzy match within threshold
    expect(result.tier).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tier 4 extended
// ---------------------------------------------------------------------------

describe('Tier 4 extended', () => {
  it('full rewrite preserves new content exactly', async () => {
    const fp = testFile('exact-rewrite.ts');
    await writeFile(fp, 'old stuff\n');
    const newContent = 'line1\nline2\nline3\n';

    const result = await editFile({
      file_path: fp,
      old_string: 'this text absolutely does not exist in the file and never will',
      new_string: newContent,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(4);
    const content = await readFile(fp, 'utf-8');
    expect(content).toBe(newContent);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('handles file with only whitespace', async () => {
    const fp = testFile('whitespace.ts');
    await writeFile(fp, '   \n\n   ');

    const result = await editFile({
      file_path: fp,
      old_string: 'some search term that wont match the whitespace file contents at all',
      new_string: 'new content',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(4);
  });

  it('handles unicode content correctly', async () => {
    const fp = testFile('unicode.ts');
    await writeFile(fp, 'const greeting = "Hello World";\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'const greeting = "Hello World";',
      new_string: 'const greeting = "Hola Mundo";',
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe(1);
    const content = await readFile(fp, 'utf-8');
    expect(content).toBe('const greeting = "Hola Mundo";\n');
  });

  it('diff_preview contains both old and new lines', async () => {
    const fp = testFile('diff.ts');
    await writeFile(fp, 'const a = 1;\n');

    const result = await editFile({
      file_path: fp,
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });

    expect(result.success).toBe(true);
    expect(result.diff_preview).toBeDefined();
    expect(result.diff_preview).toContain('- const a = 1;');
    expect(result.diff_preview).toContain('+ const a = 2;');
    expect(result.diff_preview).toContain('---');
    expect(result.diff_preview).toContain('+++');
  });
});
