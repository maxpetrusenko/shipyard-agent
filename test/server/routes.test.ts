/**
 * Extended REST API route tests.
 *
 * Covers POST /run validation, GET /health, GET /runs/:id,
 * rate limiting, context endpoints, cancel, and status.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
    const body = await res.json() as {
      status: string;
      uptime: number;
      persistence: { healthy: boolean; lastError: string | null; lastWriteAt: string | null };
    };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.persistence.healthy).toBe('boolean');
    expect(body.persistence).toHaveProperty('lastError');
    expect(body.persistence).toHaveProperty('lastWriteAt');
  });
});

describe('GET /metrics', () => {
  it('includes audit log stats', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { audit: { entries: number; sizeBytes: number } };
    expect(body.audit).toBeDefined();
    expect(typeof body.audit.entries).toBe('number');
    expect(typeof body.audit.sizeBytes).toBe('number');
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

  it('applies the composer model picker to the whole run', async () => {
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
      body: JSON.stringify({
        instruction: 'refactor small file',
        uiMode: 'plan',
        model: 'gpt-5-mini',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 50));

    const debugRes = await fetch(`${baseUrl2}/runs/${body.runId}/debug`);
    expect(debugRes.status).toBe(200);
    const debugBody = await debugRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(debugBody.modelOverride).toBe('gpt-5-mini');
    expect(debugBody.resolvedModels.coding).toBe('gpt-5-mini');
    expect(debugBody.resolvedModels.planning).toBe('gpt-5-mini');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  }, 15_000);

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

  it('does not persist ask shortcuts into disk history while running vitest', async () => {
    const prevVitest = process.env['VITEST'];
    const resultsDir = join(process.cwd(), 'results');
    const before = new Set(readdirSync(resultsDir).filter((name) => name.endsWith('.json')));
    process.env['VITEST'] = 'true';

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

    try {
      const res = await fetch(`${baseUrl2}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: 'hi', uiMode: 'ask' }),
      });
      expect(res.status).toBe(200);
      const after = readdirSync(resultsDir).filter((name) => name.endsWith('.json'));
      expect(after).toHaveLength(before.size);
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
      const after = readdirSync(resultsDir).filter((name) => name.endsWith('.json'));
      for (const name of after) {
        if (!before.has(name)) rmSync(join(resultsDir, name), { force: true });
      }
      if (prevVitest === undefined) delete process.env['VITEST'];
      else process.env['VITEST'] = prevVitest;
    }
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

  it('keeps requested agent ui mode visible in debug snapshots even when execution resolves to ask', async () => {
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
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();

    const debugRes = await fetch(`${baseUrl2}/runs/${body.runId}/debug`);
    expect(debugRes.status).toBe(200);
    const debugBody = await debugRes.json() as {
      requestedUiMode: string | null;
      runMode: string | null;
      threadKind: string | null;
      executionPath: string | null;
    };
    expect(debugBody.requestedUiMode).toBe('agent');
    expect(debugBody.runMode).toBe('auto');
    expect(debugBody.threadKind).toBe('ask');
    expect(debugBody.executionPath).toBe('local-shortcut');

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

  it('accepts a whole-run model override on ask follow-ups', async () => {
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
        model: 'gpt-5-mini',
      }),
    });
    expect(res.status).toBe(200);

    const debugRes = await fetch(`${baseUrl2}/runs/${created.runId}/debug`);
    expect(debugRes.status).toBe(200);
    const debugBody = await debugRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(debugBody.modelOverride).toBe('gpt-5-mini');
    expect(debugBody.resolvedModels.chat).toBe('gpt-5-mini');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('clears a prior model override when follow-up sends model: null', async () => {
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
      body: JSON.stringify({
        instruction: 'hi',
        uiMode: 'ask',
        model: 'gpt-5-mini',
      }),
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json() as { runId: string };

    const res = await fetch(`${baseUrl2}/runs/${created.runId}/followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'hello again',
        model: null,
      }),
    });
    expect(res.status).toBe(200);

    const debugRes = await fetch(`${baseUrl2}/runs/${created.runId}/debug`);
    expect(debugRes.status).toBe(200);
    const debugBody = await debugRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(debugBody.modelOverride).toBeNull();
    expect(debugBody.resolvedModels.chat).toBe('gpt-5.4-mini');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  }, 15_000);

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

  it('upgrades an ask thread to agent mode on same-run follow-up', async () => {
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
        instruction: 'add 1 line hello world to contributions page in ship-refactored',
        uiMode: 'agent',
        model: 'gpt-5-mini',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string; queued: boolean };
    expect(body.runId).toBe(created.runId);
    expect(body.queued).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    const run = loop2.getRun(created.runId);
    expect(run?.runId).toBe(created.runId);
    expect(run?.threadKind).toBe('agent');
    expect(run?.runMode).toBe('code');
    expect(run?.modelOverride).toBe('gpt-5-mini');

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

describe('rate limiting', () => {
  it('does not let dashboard read traffic block a new run submission', async () => {
    for (let i = 0; i < 65; i += 1) {
      const res = await fetch(`${baseUrl}/runs`);
      expect(res.status).toBe(200);
    }

    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'hi' }),
    });
    expect(res.status).toBe(200);
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

describe('invoke events controls', () => {
  it('applies from/to filters on /invoke/events/summary', async () => {
    const invokeRes = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'summary filter seed event' }),
    });
    expect(invokeRes.status).toBe(200);

    const now = new Date();
    const farFuture = new Date(now.getTime() + 86_400_000).toISOString();
    const res = await fetch(`${baseUrl}/invoke/events/summary?from=${encodeURIComponent(farFuture)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      total: number;
      bySource: Record<string, number>;
      byEventType: Record<string, number>;
      byStatus: Record<string, number>;
    };
    expect(body.total).toBe(0);
    expect(typeof body.bySource).toBe('object');
    expect(typeof body.byEventType).toBe('object');
    expect(typeof body.byStatus).toBe('object');
  });

  it('returns ordering + stopReason in /invoke/events/retry-batch', async () => {
    const invoke1 = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'retry batch order event 1' }),
    });
    expect(invoke1.status).toBe(200);
    const b1 = await invoke1.json() as { eventId: string };

    const invoke2 = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'retry batch order event 2' }),
    });
    expect(invoke2.status).toBe(200);
    const b2 = await invoke2.json() as { eventId: string };

    const retryRes = await fetch(`${baseUrl}/invoke/events/retry-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventIds: [b1.eventId, b2.eventId],
        dryRun: true,
        ordering: 'oldest_first',
        maxAccepted: 1,
      }),
    });
    expect(retryRes.status).toBe(200);
    const payload = await retryRes.json() as {
      ordering: string;
      stopReason: string;
      summary: { accepted: number; skipped: number };
    };
    expect(payload.ordering).toBe('oldest_first');
    expect(payload.stopReason).toBe('aborted_max_reached');
    expect(payload.summary.accepted).toBe(1);
    expect(payload.summary.skipped).toBeGreaterThanOrEqual(1);
  });

  it('replays idempotent retry-batch responses for same key+payload', async () => {
    const invokeRes = await fetch(`${baseUrl}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'retry-batch idempotent seed' }),
    });
    expect(invokeRes.status).toBe(200);
    const invokeBody = await invokeRes.json() as { eventId: string };

    const idemKey = `idem-retry-batch-${Date.now()}`;
    const payload = {
      eventIds: [invokeBody.eventId],
      dryRun: true,
      ordering: 'input_order',
    };

    const first = await fetch(`${baseUrl}/invoke/events/retry-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-idempotency-replayed')).toBeNull();
    const firstBody = await first.json() as { total: number; stopReason: string };
    expect(firstBody.total).toBe(1);

    const second = await fetch(`${baseUrl}/invoke/events/retry-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idemKey,
      },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('x-idempotency-replayed')).toBe('true');
    const secondBody = await second.json() as { total: number; stopReason: string };
    expect(secondBody.total).toBe(firstBody.total);
    expect(secondBody.stopReason).toBe(firstBody.stopReason);
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

  // POST /run is scoped separately from read traffic.
  // We test that the mechanism exists and responds with 429 after exceeding.
  it('returns 429 after exceeding POST /run rate limit', async () => {
    // Send 32 requests rapidly (limit is 30/min)
    const results: number[] = [];
    for (let i = 0; i < 32; i++) {
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
