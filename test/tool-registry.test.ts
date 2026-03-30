import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TOOL_SCHEMAS, dispatchTool, getExecutionToolSchemas } from '../src/tools/index.js';

describe('tool registry', () => {
  const toolNames = TOOL_SCHEMAS.map((t) => t.name);

  it('registers all 13 tools', () => {
    expect(toolNames).toHaveLength(13);
  });

  it('includes core file tools', () => {
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('edit_file');
    expect(toolNames).toContain('write_file');
  });

  it('includes search tools', () => {
    expect(toolNames).toContain('grep');
    expect(toolNames).toContain('glob');
    expect(toolNames).toContain('ls');
    expect(toolNames).toContain('web_search');
  });

  it('includes execution tools', () => {
    expect(toolNames).toContain('bash');
  });

  it('includes multi-agent tools', () => {
    expect(toolNames).toContain('spawn_agent');
    expect(toolNames).toContain('ask_user');
    expect(toolNames).toContain('revert_changes');
    expect(toolNames).toContain('commit_and_open_pr');
    expect(toolNames).toContain('inject_context');
  });

  it('all tools have valid schemas', () => {
    for (const tool of TOOL_SCHEMAS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.required).toBeInstanceOf(Array);
      expect((tool.input_schema.required as string[]).length).toBeGreaterThan(0);
    }
  });

  it('hides commit_and_open_pr from execution tools unless the user explicitly asks for it', () => {
    const names = getExecutionToolSchemas('Update README.md').map((tool) => tool.name);
    expect(names).not.toContain('commit_and_open_pr');
  });

  it('keeps commit_and_open_pr available when the user explicitly asks for a PR', () => {
    const names = getExecutionToolSchemas('Update README.md, commit it, push it, and open a PR.').map((tool) => tool.name);
    expect(names).toContain('commit_and_open_pr');
  });

  it('rejects missing required tool fields at runtime', async () => {
    const result = await dispatchTool('read_file', {});
    expect(result).toEqual({
      success: false,
      message: 'Missing required field: file_path',
    });
  });

  it('rejects invalid runtime field types', async () => {
    const result = await dispatchTool('bash', { command: 42 as unknown as string });
    expect(result).toEqual({
      success: false,
      message: 'Invalid field type for command: expected string.',
    });
  });

  it('anchors relative file tools to the supplied workdir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'shipyard-tool-workdir-'));
    const relativePath = 'app/src/index.ts';
    const outsidePath = resolve(process.cwd(), relativePath);

    const writeResult = await dispatchTool(
      'write_file',
      { file_path: relativePath, content: 'export const ok = true;\n' },
      undefined,
      undefined,
      workDir,
    );
    expect(writeResult.success).toBe(true);
    expect(existsSync(join(workDir, relativePath))).toBe(true);
    expect(existsSync(outsidePath)).toBe(false);

    const readResult = await dispatchTool(
      'read_file',
      { file_path: relativePath },
      undefined,
      undefined,
      workDir,
    );
    expect(readResult.success).toBe(true);
    expect(readResult.content).toContain('export const ok = true;');
  });

  it('rejects absolute file writes outside the supplied workdir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'shipyard-tool-scope-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'shipyard-tool-outside-'));
    const outsidePath = join(outsideDir, 'src/index.ts');

    const result = await dispatchTool(
      'write_file',
      { file_path: outsidePath, content: 'export const nope = true;\n' },
      undefined,
      undefined,
      workDir,
    );

    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('selected project root');
    expect(existsSync(outsidePath)).toBe(false);
  });

  it('rejects bash cwd outside the supplied workdir', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'shipyard-tool-bash-root-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'shipyard-tool-bash-outside-'));

    const result = await dispatchTool(
      'bash',
      { command: 'pwd', cwd: outsideDir },
      undefined,
      undefined,
      workDir,
    );

    expect(result.success).toBe(false);
    expect(String(result.message)).toContain('selected project root');
  });
});
