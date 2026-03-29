/**
 * Extended LangSmith tracing helper tests.
 *
 * The root test/langsmith.test.ts covers the core behavior; this file
 * adds additional edge cases and integration scenarios.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  isTracingEnabled,
  getTraceProject,
  buildTraceUrl,
  canTrace,
  getLangSmithApiKey,
  resolveLangSmithRunUrl,
} from '../../src/runtime/langsmith.js';

describe('langsmith extended tests', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // isTracingEnabled
  // -------------------------------------------------------------------------

  describe('isTracingEnabled edge cases', () => {
    it('returns false for LANGCHAIN_TRACING_V2=false', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'false';
      delete process.env['LANGSMITH_TRACING'];
      expect(isTracingEnabled()).toBe(false);
    });

    it('returns false for empty string', () => {
      process.env['LANGCHAIN_TRACING_V2'] = '';
      delete process.env['LANGSMITH_TRACING'];
      expect(isTracingEnabled()).toBe(false);
    });

    it('LANGSMITH_TRACING takes priority order (checked first in OR)', () => {
      process.env['LANGSMITH_TRACING'] = 'true';
      process.env['LANGCHAIN_TRACING_V2'] = 'false';
      expect(isTracingEnabled()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // buildTraceUrl format
  // -------------------------------------------------------------------------

  describe('buildTraceUrl format', () => {
    it('includes the run id in the URL path', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      delete process.env['LANGSMITH_PROJECT'];
      delete process.env['LANGCHAIN_PROJECT'];

      const url = buildTraceUrl('my-run-id');
      expect(url).toContain('/r/my-run-id');
    });

    it('includes the project name in the URL path', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGSMITH_PROJECT'] = 'my-project';

      const url = buildTraceUrl('run-1');
      expect(url).toContain('/p/my-project/');
    });

    it('uses smith.langchain.com as host', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      const url = buildTraceUrl('run-x');
      expect(url).toContain('https://smith.langchain.com');
    });

    it('returns null when tracing is disabled', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      delete process.env['LANGSMITH_TRACING'];
      expect(buildTraceUrl('run-1')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // canTrace when keys missing
  // -------------------------------------------------------------------------

  describe('canTrace edge cases', () => {
    it('false when tracing disabled even with api key', () => {
      delete process.env['LANGCHAIN_TRACING_V2'];
      delete process.env['LANGSMITH_TRACING'];
      process.env['LANGSMITH_API_KEY'] = 'key';
      expect(canTrace()).toBe(false);
    });

    it('false when api key is empty string', () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGSMITH_API_KEY'] = '';
      delete process.env['LANGCHAIN_API_KEY'];
      expect(canTrace()).toBe(false);
    });

    it('true with LANGSMITH env vars', () => {
      process.env['LANGSMITH_TRACING'] = 'true';
      process.env['LANGSMITH_API_KEY'] = 'ls-key-123';
      expect(canTrace()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getLangSmithApiKey edge cases
  // -------------------------------------------------------------------------

  describe('getLangSmithApiKey edge cases', () => {
    it('trims whitespace from api key', () => {
      process.env['LANGSMITH_API_KEY'] = '  my-key  ';
      delete process.env['LANGCHAIN_API_KEY'];
      expect(getLangSmithApiKey()).toBe('my-key');
    });

    it('returns null for whitespace-only key', () => {
      process.env['LANGSMITH_API_KEY'] = '   ';
      delete process.env['LANGCHAIN_API_KEY'];
      expect(getLangSmithApiKey()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // resolveLangSmithRunUrl
  // -------------------------------------------------------------------------

  describe('resolveLangSmithRunUrl edge cases', () => {
    it('retries on 404 then succeeds when public enabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'true';

      let attempts = 0;
      const mockClient = {
        readRunSharedLink: async () => {
          attempts++;
          if (attempts < 3) {
            const e = new Error('not found');
            (e as any).status = 404;
            throw e;
          }
          return 'https://smith.langchain.com/public/found/r';
        },
        shareRun: async () => 'https://smith.langchain.com/public/shared/r',
      };

      const url = await resolveLangSmithRunUrl('run-retry', mockClient, 5, 0);
      expect(url).toBeTruthy();
    });

    it('returns null after all retry attempts exhausted when public enabled', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'true';

      const mockClient = {
        readRunSharedLink: async () => {
          const e = new Error('not found');
          (e as any).status = 404;
          throw e;
        },
        shareRun: async () => {
          const e = new Error('not found');
          (e as any).status = 404;
          throw e;
        },
      };

      const url = await resolveLangSmithRunUrl('run-exhaust', mockClient, 2, 0);
      expect(url).toBeNull();
    });

    it('returns internal URL when public explicitly disabled even when API would fail', async () => {
      process.env['LANGCHAIN_TRACING_V2'] = 'true';
      process.env['LANGCHAIN_API_KEY'] = 'key';
      process.env['SHIPYARD_TRACE_PUBLIC'] = 'false';

      const mockClient = {
        readRunSharedLink: async () => { throw new Error('should not be called'); },
        shareRun: async () => { throw new Error('should not be called'); },
      };

      const url = await resolveLangSmithRunUrl('run-internal', mockClient, 2, 0);
      expect(url).toContain('/r/run-internal');
    });
  });
});
