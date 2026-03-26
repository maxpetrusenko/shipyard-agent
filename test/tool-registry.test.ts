import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS, getExecutionToolSchemas } from '../src/tools/index.js';

describe('tool registry', () => {
  const toolNames = TOOL_SCHEMAS.map((t) => t.name);

  it('registers all 12 tools', () => {
    expect(toolNames).toHaveLength(12);
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
});
