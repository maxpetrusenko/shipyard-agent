/**
 * Extended REST API route tests.
 *
 * Covers POST /run validation, GET /health, GET /runs/:id,
 * rate limiting, context endpoints, cancel, and status.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

let server: Server;
let port: number;
let baseUrl: string;

const loop = new InstructionLoop();

beforeAll(async () => {
  const app = createApp(loop);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://localhost:${port}/api`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { status: string; uptime: number };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// POST /run validation
// ---------------------------------------------------------------------------

describe('POST /run validation', () => {
  it('rejects missing instruction', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('instruction is required');
  });

  it('rejects empty instruction', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid instruction', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'test instruction' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();
  });

  it('accepts instruction with contexts', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'test',
        contexts: [{ label: 'ctx', content: 'data', source: 'user' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();
  });

  it('returns immediate ask result for trivial hi', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      phase?: string;
      threadKind?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(body.runId).toBeTruthy();
    expect(body.phase).toBe('done');
    expect(body.threadKind).toBe('ask');
    expect(body.messages?.at(-1)?.role).toBe('assistant');
  });

  it('keeps agent ui mode on auto so simple asks do not enter planning', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const res = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '2=2?', uiMode: 'agent' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      runMode?: string;
      phase?: string;
      threadKind?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(body.runId).toBeTruthy();
    expect(body.runMode).toBe('auto');
    expect(body.phase).toBe('done');
    expect(body.threadKind).toBe('ask');
    expect(body.messages?.at(-1)?.content).toContain('Answer: true');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });
});

describe('POST /runs/:id/followup', () => {
  it('returns immediate ask follow-up result for trivial hi', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const createRes = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { runId: string };

    const res = await fetch(`${baseUrl2}/runs/${created.runId}/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      queued: boolean;
      phase?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(body.runId).toBe(created.runId);
    expect(body.queued).toBe(true);
    expect(body.phase).toBe('done');
    expect(body.messages?.length).toBeGreaterThanOrEqual(4);
    expect(body.messages?.at(-1)?.role).toBe('assistant');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('accepts fresh model settings on ask follow-ups', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const createRes = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { runId: string };

    const res = await fetch(`${baseUrl2}/runs/${created.runId}/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'hi',
        modelFamily: 'openai',
      }),
    });
    expect(res.status).toBe(200);

    const debugRes = await fetch(`${baseUrl2}/runs/${created.runId}/debug`);
    expect(debugRes.status).toBe(200);
    const debugBody = await debugRes.json() as {
      modelFamily: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(debugBody.modelFamily).toBe('openai');
    expect(debugBody.resolvedModels.chat).toBe('gpt-5-mini');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('queues code follow-ups on the same run id', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const createRes = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'implement auth', uiMode: 'agent' }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { runId: string };

    await new Promise((r) => setTimeout(r, 200));

    const res = await fetch(`${baseUrl2}/runs/${created.runId}/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'refactor small file' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string; queued: boolean };
    expect(body.runId).toBe(created.runId);
    expect(body.queued).toBe(true);

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });
});

// ---------------------------------------------------------------------------
// GET /runs/:id
// ---------------------------------------------------------------------------

describe('GET /runs/:id', () => {
  it('returns 404 for unknown run', async () => {
    const res = await fetch(`${baseUrl}/runs/nonexistent-id`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Run not found');
  });

  it('returns a debug snapshot with local trace fallback', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const createRes = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { runId: string };

    const res = await fetch(`${baseUrl2}/runs/${created.runId}/debug`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      executionPath: string;
      openTraceUrl: string;
      localTraceUrl: string;
      primaryModel: string | null;
    };
    expect(body.runId).toBe(created.runId);
    expect(body.executionPath).toBe('local-shortcut');
    expect(body.localTraceUrl).toBe(`/api/runs/${created.runId}/debug`);
    expect(body.openTraceUrl).toBe(body.localTraceUrl);
    expect(body.primaryModel).toBeNull();

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });
});

describe('DELETE /runs/:id', () => {
  it('deletes an existing run', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const createRes = await fetch(`${baseUrl2}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
    });
    const created = await createRes.json() as { runId: string };

    const deleteRes = await fetch(`${baseUrl2}/runs/${created.runId}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl2}/runs/${created.runId}`);
    expect(getRes.status).toBe(404);

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('returns 409 when deleting the active run', async () => {
    const loop2 = new InstructionLoop();
    const app2 = createApp(loop2);
    const server2 = createServer(app2);
    const baseUrl2 = await new Promise<string>((resolve) => {
      server2.listen(0, () => {
        const addr = server2.address();
        const port2 = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`http://localhost:${port2}/api`);
      });
    });

    const runId = loop2.submit('hi', undefined, false, 'chat');
    const loopHack = loop2 as unknown as {
      processing: boolean;
      currentRunId: string | null;
    };
    loopHack.processing = true;
    loopHack.currentRunId = runId;

    const deleteRes = await fetch(`${baseUrl2}/runs/${runId}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(409);
    const body = await deleteRes.json() as { error: string };
    expect(body.error).toContain('active');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('returns 404 when run does not exist', async () => {
    const del = await fetch(`${baseUrl}/runs/definitely-missing-run-id-xyz`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /runs (pagination)
// ---------------------------------------------------------------------------

describe('GET /runs pagination', () => {
  it('returns array with default pagination', async () => {
    const res = await fetch(`${baseUrl}/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('respects limit query param', async () => {
    const res = await fetch(`${baseUrl}/runs?limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(1);
  });

  it('respects offset query param', async () => {
    const res = await fetch(`${baseUrl}/runs?limit=10&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /inject
// ---------------------------------------------------------------------------

describe('POST /inject', () => {
  it('rejects missing label', async () => {
    const res = await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'data' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing content', async () => {
    const res = await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid injection', async () => {
    const res = await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'test-inject', content: 'injected data', source: 'user' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /contexts and DELETE /contexts/:label
// ---------------------------------------------------------------------------

describe('context CRUD', () => {
  it('lists injected contexts', async () => {
    // Inject first
    await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'list-test', content: 'data', source: 'system' }),
    });

    const res = await fetch(`${baseUrl}/contexts`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ label: string }>;
    expect(body.some((c) => c.label === 'list-test')).toBe(true);
  });

  it('deletes context by label', async () => {
    await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'delete-me', content: 'data', source: 'user' }),
    });

    const res = await fetch(`${baseUrl}/contexts/delete-me`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('returns 404 for deleting non-existent context', async () => {
    const res = await fetch(`${baseUrl}/contexts/no-such-context`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /cancel
// ---------------------------------------------------------------------------

describe('POST /cancel', () => {
  it('returns a valid cancel response', async () => {
    const res = await fetch(`${baseUrl}/cancel`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { cancelled: boolean };
    expect(typeof body.cancelled).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

describe('GET /status', () => {
  it('returns queue status object', async () => {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as { processing: boolean; currentRunId: string | null; queueLength: number };
    expect(typeof body.processing).toBe('boolean');
    expect(typeof body.queueLength).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('rate limiting', () => {
  it('allows requests within the rate limit', async () => {
    // Single request should always be within limits
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  // Rate limit is 10/min for POST /run, 60/min for others.
  // We test that the mechanism exists and responds with 429 after exceeding.
  it('returns 429 after exceeding POST /run rate limit', async () => {
    // Send 12 requests rapidly (limit is 10/min)
    const results: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${baseUrl}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: `rate-test-${i}` }),
      });
      results.push(res.status);
    }

    // At least one should be 429 (rate limited)
    expect(results).toContain(429);
  });
});
