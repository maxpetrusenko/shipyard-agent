import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop, type RunResult } from '../../src/runtime/loop.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const loop = new InstructionLoop();
  const loopHack = loop as unknown as {
    initialized: boolean;
    runs: Map<string, RunResult>;
  };
  loopHack.initialized = true;
  loopHack.runs = new Map<string, RunResult>([
    [
      'ask-run',
      {
        runId: 'ask-run',
        phase: 'done',
        steps: [],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: { input: 10, output: 5 },
        traceUrl: null,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 50,
        threadKind: 'ask',
        runMode: 'chat',
        executionPath: 'local-shortcut',
        savedAt: '2026-03-24T10:00:00.000Z',
      },
    ],
    [
      'refactor-run',
      {
        runId: 'refactor-run',
        phase: 'done',
        steps: [
          {
            index: 1,
            description: 'Refactor run history page',
            files: ['src/server/runs.ts'],
            status: 'done',
          },
        ],
        fileEdits: [
          {
            file_path: '/Users/maxpetrusenko/Desktop/Projects/ship/src/app.tsx',
            old_string: 'old',
            new_string: 'new',
            tier: 1,
          },
        ],
        toolCallHistory: [
          {
            tool_name: 'edit_file',
            tool_input: { file_path: '/Users/maxpetrusenko/Desktop/Projects/ship/src/app.tsx' },
            tool_result: 'ok',
            duration_ms: 42,
          },
        ],
        tokenUsage: { input: 100, output: 50 },
        traceUrl: 'https://example.com/trace',
        messages: [
          { role: 'user', content: 'refactor ship repo runs page' },
          { role: 'assistant', content: 'done' },
        ],
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 4200,
        threadKind: 'agent',
        runMode: 'code',
        executionPath: 'graph',
        savedAt: '2026-03-24T12:00:00.000Z',
      },
    ],
    [
      'untitled-run',
      {
        runId: 'untitled-run',
        phase: 'done',
        steps: [
          {
            index: 1,
            description: 'Empty run',
            files: [],
            status: 'done',
          },
        ],
        fileEdits: [
          {
            file_path: '/Users/maxpetrusenko/Desktop/Projects/ship/src/legacy.ts',
            old_string: 'a',
            new_string: 'b',
            tier: 1,
          },
        ],
        toolCallHistory: [
          {
            tool_name: 'read_file',
            tool_input: { file_path: '/tmp/example.ts' },
            tool_result: 'ok',
            duration_ms: 12,
          },
        ],
        tokenUsage: { input: 12, output: 4 },
        traceUrl: null,
        messages: [
          { role: 'user', content: '   ' },
          { role: 'assistant', content: 'done' },
        ],
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 300,
        threadKind: 'agent',
        runMode: 'code',
        executionPath: 'graph',
        savedAt: '2026-03-24T11:00:00.000Z',
      },
    ],
    [
      'no-tools-run',
      {
        runId: 'no-tools-run',
        phase: 'done',
        steps: [
          {
            index: 1,
            description: 'Plan only',
            files: [],
            status: 'done',
          },
        ],
        fileEdits: [],
        toolCallHistory: [],
        tokenUsage: { input: 22, output: 9 },
        traceUrl: null,
        messages: [
          { role: 'user', content: 'refactor but with no tool trace' },
          { role: 'assistant', content: 'done' },
        ],
        error: null,
        verificationResult: null,
        reviewFeedback: null,
        durationMs: 600,
        threadKind: 'agent',
        runMode: 'code',
        executionPath: 'graph',
        savedAt: '2026-03-24T11:30:00.000Z',
      },
    ],
  ]);

  const app = createApp(loop);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /runs', () => {
  it('renders the refactoring runs page', async () => {
    const res = await fetch(`${baseUrl}/runs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Refactoring Runs');
    expect(html).toContain('refactor ship repo runs page');
  });

  it('filters out ask-only chat runs by default', async () => {
    const res = await fetch(`${baseUrl}/runs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('>hi<');
    expect(html).not.toContain('hello');
  });

  it('filters out untitled runs and runs with no tool usage', async () => {
    const res = await fetch(`${baseUrl}/runs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('Untitled run');
    expect(html).not.toContain('refactor but with no tool trace');
    expect(html).toContain('Empty run');
  });
});
