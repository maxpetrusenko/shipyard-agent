import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTracingEnabled, getTraceProject, buildTraceUrl } from '../src/runtime/langsmith.js';

describe('langsmith tracing helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isTracingEnabled', () => {
    it('returns true when LANGCHAIN_TRACING_V2=true', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      expect(isTracingEnabled()).toBe(true);
    });

    it('returns false when not set', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      expect(isTracingEnabled()).toBe(false);
    });

    it('returns false for other values', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'yes';
      expect(isTracingEnabled()).toBe(false);
    });
  });

  describe('getTraceProject', () => {
    it('returns LANGCHAIN_PROJECT when set', () => {
      process.env['LANGCHAIN_PROJECT'] = 'my-project';
      expect(getTraceProject()).toBe('my-project');
    });

    it('defaults to shipyard', () => {
      delete process.env['LANGCHAIN_PROJECT'];
      expect(getTraceProject()).toBe('shipyard');
    });
  });

  describe('buildTraceUrl', () => {
    it('returns null when tracing is disabled', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      expect(buildTraceUrl('run-123')).toBeNull();
    });

    it('returns LangSmith URL when tracing is enabled', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_PROJECT'] = 'test-proj';

      const url = buildTraceUrl('run-abc');
      expect(url).toBe('https://smith.langchain.com/o/default/projects/p/test-proj/r/run-abc');
    });

    it('uses default project name in URL', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      delete process.env['LANGCHAIN_PROJECT'];

      const url = buildTraceUrl('run-xyz');
      expect(url).toContain('/p/shipyard/');
    });
  });
});
