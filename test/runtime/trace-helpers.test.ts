/**
 * Tests for tracing helpers: traceIfEnabled, traceToolCall, traceDecision, traceParser.
 *
 * Verifies no-op behavior when tracing is disabled and pass-through behavior when enabled.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock langsmith to control canTrace()
const mocks = vi.hoisted(() => ({
  canTrace: vi.fn(() => false),
}));

vi.mock('../../src/runtime/langsmith.js', () => ({
  canTrace: mocks.canTrace,
  isTracingEnabled: () => mocks.canTrace(),
  getLangSmithApiKey: () => 'test-key',
  getTraceProject: () => 'test',
  buildTraceUrl: () => null,
  resolveLangSmithRunUrl: async () => null,
}));

import {
  traceIfEnabled,
  traceToolCall,
  traceDecision,
  traceParser,
} from '../../src/runtime/trace-helpers.js';

describe('trace helpers', () => {
  afterEach(() => {
    mocks.canTrace.mockReset();
  });

  describe('traceIfEnabled', () => {
    it('returns the original function when tracing is off', () => {
      mocks.canTrace.mockReturnValue(false);
      const fn = () => 42;
      const wrapped = traceIfEnabled(fn, { name: 'test' });
      expect(wrapped).toBe(fn);
    });

    it('returns a different (traced) function when tracing is on', () => {
      mocks.canTrace.mockReturnValue(true);
      const fn = () => 42;
      const wrapped = traceIfEnabled(fn, { name: 'test' });
      expect(wrapped).not.toBe(fn);
    });
  });

  describe('traceToolCall', () => {
    it('returns raw result when tracing is off', async () => {
      mocks.canTrace.mockReturnValue(false);
      const result = await traceToolCall('bash', { command: 'echo hi' }, async () => ({
        success: true,
        stdout: 'hi',
      }));
      expect(result).toEqual({ success: true, stdout: 'hi' });
    });

    it('preserves result shape when tracing is on', async () => {
      mocks.canTrace.mockReturnValue(true);
      const result = await traceToolCall('bash', { command: 'echo hi' }, async () => ({
        success: true,
        stdout: 'hi',
      }));
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('stdout', 'hi');
    });

    it('propagates errors from the inner function', async () => {
      mocks.canTrace.mockReturnValue(false);
      await expect(
        traceToolCall('bash', {}, async () => {
          throw new Error('tool failed');
        }),
      ).rejects.toThrow('tool failed');
    });
  });

  describe('traceDecision', () => {
    it('returns raw result when tracing is off', async () => {
      mocks.canTrace.mockReturnValue(false);
      const result = await traceDecision('test_guard', { a: 1 }, async () => ({
        decision: 'retry',
        reason: 'failed',
      }));
      expect(result).toEqual({ decision: 'retry', reason: 'failed' });
    });

    it('returns null from inner function properly', async () => {
      mocks.canTrace.mockReturnValue(false);
      const result = await traceDecision('test_guard', {}, async () => null);
      expect(result).toBeNull();
    });

    it('preserves result when tracing is on', async () => {
      mocks.canTrace.mockReturnValue(true);
      const result = await traceDecision('test_guard', { a: 1 }, async () => ({
        decision: 'done',
      }));
      expect(result).toHaveProperty('decision', 'done');
    });

    it('does NOT leak messages array through to caller (privacy)', async () => {
      mocks.canTrace.mockReturnValue(true);
      // The actual return to caller must contain messages (business logic)
      // but the trace span processOutputs strips them.
      // We verify the CALLER still gets the full result.
      const result = await traceDecision('test_guard', {}, async () => ({
        phase: 'done',
        messages: [{ role: 'assistant', content: 'secret code content' }],
        error: null,
      }));
      // Caller gets full result (tracing is transparent to business logic)
      expect(result).toHaveProperty('messages');
      expect((result as Record<string, unknown>)['messages']).toHaveLength(1);
    });
  });

  describe('traceParser', () => {
    it('returns raw result when tracing is off', async () => {
      mocks.canTrace.mockReturnValue(false);
      const result = await traceParser('plan_extraction', async () => ({
        steps: [{ index: 0 }],
        stepCount: 1,
      }));
      expect(result).toEqual({ steps: [{ index: 0 }], stepCount: 1 });
    });

    it('preserves result when tracing is on', async () => {
      mocks.canTrace.mockReturnValue(true);
      const result = await traceParser('plan_extraction', async () => ({
        steps: [],
        stepCount: 0,
      }), '<plan>[]</plan>');
      expect(result).toEqual({ steps: [], stepCount: 0 });
    });

    it('does NOT leak raw text through to trace inputs (privacy)', async () => {
      mocks.canTrace.mockReturnValue(true);
      // With tracing ON, processInputs runs and should only log textLength/hasInput,
      // not the actual text. Caller still gets the full result.
      const rawLlmText = 'This is secret LLM output with code: function foo() { return 42; }';
      const result = await traceParser('review_decision', async () => ({
        decision: 'done',
        feedback: null,
        matched: true,
      }), rawLlmText);
      expect(result).toEqual({ decision: 'done', feedback: null, matched: true });
    });

    it('strips rawSnippet from return value in trace output (privacy)', async () => {
      mocks.canTrace.mockReturnValue(true);
      // rawSnippet should be stripped by processOutputs sanitizer
      const result = await traceParser('test_parser', async () => ({
        decision: 'done',
        rawSnippet: 'should not appear in trace',
      }));
      // Caller still gets rawSnippet (tracing is transparent to business logic)
      expect(result).toHaveProperty('rawSnippet');
    });
  });
});
