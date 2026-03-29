import { describe, it, expect, afterEach } from 'vitest';
import {
  isTracingEnabled,
  getTraceProject,
  buildTraceUrl,
  canTrace,
  getLangSmithApiKey,
  isLangSmithInternalTraceUrl,
  isLangSmithPublicTraceUrl,
  resolveLangSmithRunUrl,
} from '../src/runtime/langsmith.js';

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

    it('returns true when LANGSMITH_TRACING=true', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      process.env['LANGSMITH_TRACING'] = 'true';
      expect(isTracingEnabled()).toBe(true);
    });

    it('returns false when not set', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      delete process.env['LANGSMITH_TRACING'];
      expect(isTracingEnabled()).toBe(false);
    });

    it('returns false for other values', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'yes';
      expect(isTracingEnabled()).toBe(false);
    });
  });

  describe('getLangSmithApiKey', () => {
    it('prefers LANGSMITH_API_KEY', () => {
      process.env['LANGSMITH_API_KEY'] = 'modern-key';
      process.env['LANGCHAIN_API_KEY'] = 'legacy-key';
      expect(getLangSmithApiKey()).toBe('modern-key');
    });

    it('falls back to LANGCHAIN_API_KEY', () => {
      delete process.env['LANGSMITH_API_KEY'];
      process.env['LANGCHAIN_API_KEY'] = 'legacy-key';
      expect(getLangSmithApiKey()).toBe('legacy-key');
    });

    it('returns null when neither set', () => {
      delete process.env['LANGSMITH_API_KEY'];
      delete process.env['LANGCHAIN_API_KEY'];
      expect(getLangSmithApiKey()).toBeNull();
    });
  });

  describe('canTrace', () => {
    it('true when tracing enabled + api key set', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      expect(canTrace()).toBe(true);
    });

    it('false when no api key', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      delete process.env['LANGCHAIN_API_KEY'];
      delete process.env['LANGSMITH_API_KEY'];
      expect(canTrace()).toBe(false);
    });
  });

  describe('getTraceProject', () => {
    it('prefers LANGSMITH_PROJECT', () => {
      process.env['LANGSMITH_PROJECT'] = 'modern';
      process.env['LANGCHAIN_PROJECT'] = 'legacy';
      expect(getTraceProject()).toBe('modern');
    });

    it('falls back to LANGCHAIN_PROJECT', () => {
      delete process.env['LANGSMITH_PROJECT'];
      process.env['LANGCHAIN_PROJECT'] = 'my-project';
      expect(getTraceProject()).toBe('my-project');
    });

    it('defaults to shipyard', () => {
      delete process.env['LANGCHAIN_PROJECT'];
      delete process.env['LANGSMITH_PROJECT'];
      expect(getTraceProject()).toBe('shipyard');
    });
  });

  describe('buildTraceUrl', () => {
    it('returns null when tracing is disabled', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      delete process.env['LANGSMITH_TRACING'];
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
      delete process.env['LANGSMITH_PROJECT'];

      const url = buildTraceUrl('run-xyz');
      expect(url).toContain('/p/shipyard/');
    });
  });

  describe('resolveLangSmithRunUrl', () => {
    it('returns null when tracing disabled', async () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      delete process.env['LANGSMITH_TRACING'];
      expect(await resolveLangSmithRunUrl('run-1')).toBeNull();
    });

    it('returns null for empty runId', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      expect(await resolveLangSmithRunUrl('')).toBeNull();
    });

    it('returns internal workspace URL when public sharing explicitly disabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'false';

      const mockClient = {
        readRunSharedLink: async () => { throw new Error('should not be called'); },
        shareRun: async () => { throw new Error('should not be called'); },
      };

      const url = await resolveLangSmithRunUrl('run-1', mockClient);
      expect(url).toContain('/o/default/projects/p/');
      expect(url).toContain('/r/run-1');
    });

    it('prefers existing shared link over workspace app URL when public enabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'true';

      const mockClient = {
        getRunUrl: async () => 'https://smith.langchain.com/o/real/projects/p/real/r/run-1?poll=true',
        readRunSharedLink: async () => 'https://smith.langchain.com/public/abc/r',
        shareRun: async () => { throw new Error('should not be called'); },
      };

      const url = await resolveLangSmithRunUrl('run-1', mockClient);
      expect(url).toBe('https://smith.langchain.com/public/abc/r');
    });

    it('creates new share link when none exists and public enabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'true';

      const mockClient = {
        readRunSharedLink: async () => { const e = new Error('not found'); (e as any).status = 404; throw e; },
        shareRun: async () => 'https://smith.langchain.com/public/new-token/r',
      };

      const url = await resolveLangSmithRunUrl('run-2', mockClient);
      expect(url).toBe('https://smith.langchain.com/public/new-token/r');
    });

    it('returns null on persistent failure when public enabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'true';

      const mockClient = {
        readRunSharedLink: async () => { throw new Error('server error'); },
        shareRun: async () => { throw new Error('server error'); },
      };

      const url = await resolveLangSmithRunUrl('run-3', mockClient, 1, 0);
      expect(url).toBeNull();
    });
  });

  describe('LangSmith URL classification', () => {
    it('marks shared trace links as public', () => {
      expect(
        isLangSmithPublicTraceUrl(
          'https://smith.langchain.com/public/abc123/r?foo=bar',
        ),
      ).toBe(true);
    });

    it('marks org/project trace links as internal even with query params', () => {
      expect(
        isLangSmithInternalTraceUrl(
          'https://smith.langchain.com/o/897647a5-0ac2-484c-a932-6f0fadab2950/projects/p/37f8686f-b665-4c2c-9fba-be0e39a74eb2/r/1fa2e73d-da09-4f3f-81de-0829746d967d?trace_id=1fa2e73d-da09-4f3f-81de-0829746d967d&start_time=2026-03-26T17:53:41.794001',
        ),
      ).toBe(true);
      expect(
        isLangSmithPublicTraceUrl(
          'https://smith.langchain.com/o/897647a5-0ac2-484c-a932-6f0fadab2950/projects/p/37f8686f-b665-4c2c-9fba-be0e39a74eb2/r/1fa2e73d-da09-4f3f-81de-0829746d967d?trace_id=1fa2e73d-da09-4f3f-81de-0829746d967d&start_time=2026-03-26T17:53:41.794001',
        ),
      ).toBe(false);
    });
  });
});
