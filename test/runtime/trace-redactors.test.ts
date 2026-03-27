/**
 * Tests for per-tool input/output redaction.
 */

import { describe, it, expect } from 'vitest';
import { redactToolInput, redactToolOutput } from '../../src/runtime/trace-redactors.js';

describe('redactToolInput', () => {
  it('redacts write_file content into lineCount + contentHash', () => {
    const result = redactToolInput('write_file', {
      file_path: '/tmp/x.ts',
      content: 'line1\nline2\nline3',
    });
    expect(result).toHaveProperty('file_path', '/tmp/x.ts');
    expect(result).toHaveProperty('lineCount', 3);
    expect(result).toHaveProperty('contentHash');
    expect(typeof result['contentHash']).toBe('string');
    expect((result['contentHash'] as string).length).toBe(8);
    expect(result).not.toHaveProperty('content');
  });

  it('redacts edit_file old_string/new_string into lengths', () => {
    const result = redactToolInput('edit_file', {
      file_path: '/tmp/a.ts',
      old_string: 'abc',
      new_string: 'abcdef',
    });
    expect(result).toHaveProperty('file_path', '/tmp/a.ts');
    expect(result).toHaveProperty('old_string_length', 3);
    expect(result).toHaveProperty('new_string_length', 6);
    expect(result).not.toHaveProperty('old_string');
    expect(result).not.toHaveProperty('new_string');
  });

  it('passes short bash command through unchanged', () => {
    const result = redactToolInput('bash', { command: 'ls -la', timeout: 5000 });
    expect(result).toEqual({ command: 'ls -la', commandLength: 6, timeout: 5000, cwd: undefined });
  });

  it('truncates long bash commands to 200 chars', () => {
    const longCmd = 'echo ' + 'x'.repeat(600);
    const result = redactToolInput('bash', { command: longCmd });
    expect((result['command'] as string).length).toBeLessThanOrEqual(203);
    expect((result['command'] as string)).toContain('...');
    expect(result).toHaveProperty('commandLength', longCmd.length);
  });

  it('truncates spawn_agent task to 200 chars', () => {
    const longTask = 'x'.repeat(300);
    const result = redactToolInput('spawn_agent', { task: longTask, role: 'test' });
    expect((result['task'] as string).length).toBeLessThanOrEqual(203); // 200 + '...'
    expect(result).toHaveProperty('role', 'test');
  });

  it('passes read_file through unchanged', () => {
    const result = redactToolInput('read_file', { file_path: '/tmp/f.ts', offset: 10, limit: 50 });
    expect(result).toEqual({ file_path: '/tmp/f.ts', offset: 10, limit: 50 });
  });

  it('redacts commit_and_open_pr body', () => {
    const result = redactToolInput('commit_and_open_pr', {
      title: 'Fix bug',
      body: 'Long markdown body...',
      branch_name: 'fix/bug',
      base_branch: 'main',
      draft: true,
    });
    expect(result).toHaveProperty('title', 'Fix bug');
    expect(result).not.toHaveProperty('body');
    expect(result).toHaveProperty('draft', true);
  });

  it('redacts inject_context content into length', () => {
    const result = redactToolInput('inject_context', {
      label: 'docs',
      content: 'a'.repeat(5000),
    });
    expect(result).toEqual({ label: 'docs', content_length: 5000 });
  });
});

describe('redactToolOutput', () => {
  it('redacts read_file content into metadata only (no preview, no raw content)', () => {
    const longContent = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const result = redactToolOutput('read_file', { content: longContent, success: true });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('lineCount', 20);
    expect(result).toHaveProperty('charCount');
    expect(result).toHaveProperty('contentHash');
    expect(result).not.toHaveProperty('content');
    expect(result).not.toHaveProperty('preview');
  });

  it('redacts bash stdout into lengths + truncated flag (no raw output)', () => {
    const bigStdout = 'x'.repeat(10_000);
    const result = redactToolOutput('bash', {
      success: true,
      exit_code: 0,
      stdout: bigStdout,
      stderr: '',
      duration_ms: 100,
    });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('exit_code', 0);
    expect(result).toHaveProperty('stdout_length', 10_000);
    expect(result).toHaveProperty('truncated', true);
    expect(result).not.toHaveProperty('output_preview');
    expect(result).not.toHaveProperty('stdout');
  });

  it('marks bash output as not truncated when small', () => {
    const result = redactToolOutput('bash', {
      success: true,
      exit_code: 0,
      stdout: 'hello',
      stderr: '',
    });
    expect(result).toHaveProperty('truncated', false);
  });

  it('redacts glob files to first 10 paths', () => {
    const files = Array.from({ length: 25 }, (_, i) => `/src/file${i}.ts`);
    const result = redactToolOutput('glob', { success: true, files });
    expect(result).toHaveProperty('file_count', 25);
    expect((result['first_paths'] as string[]).length).toBe(10);
    expect(result).toHaveProperty('truncated', true);
  });

  it('does not truncate small glob results', () => {
    const files = ['/a.ts', '/b.ts'];
    const result = redactToolOutput('glob', { success: true, files });
    expect(result).toHaveProperty('file_count', 2);
    expect(result).toHaveProperty('truncated', false);
  });

  it('returns write_file success + message (matches actual tool shape)', () => {
    const result = redactToolOutput('write_file', {
      success: true,
      message: 'Wrote 42 lines to /tmp/x.ts',
    });
    expect(result).toEqual({ success: true, message: 'Wrote 42 lines to /tmp/x.ts' });
  });

  it('returns edit_file success + tier + message (matches actual tool shape)', () => {
    const result = redactToolOutput('edit_file', {
      success: true,
      tier: 1,
      message: 'Replaced 1 occurrence in /tmp/a.ts',
      diff_preview: '--- a\n+++ b\n...',
    });
    expect(result).toEqual({ success: true, tier: 1, message: 'Replaced 1 occurrence in /tmp/a.ts' });
    expect(result).not.toHaveProperty('diff_preview');
  });

  it('handles unknown tools gracefully', () => {
    const result = redactToolOutput('nonexistent_tool', { success: true, data: 'secret' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('truncated', false);
  });
});
