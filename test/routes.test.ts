import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { InstructionLoop } from '../src/runtime/loop.js';

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

describe('health endpoint', () => {
  it('returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { status: string };
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });
});

describe('POST /run', () => {
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

  it('accepts valid instruction and returns runId', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'test instruction' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();
  });
});

describe('GET /runs (pagination)', () => {
  it('returns array with default pagination', async () => {
    const res = await fetch(`${baseUrl}/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('respects limit and offset params', async () => {
    const res = await fetch(`${baseUrl}/runs?limit=1&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(1);
  });
});

describe('context CRUD', () => {
  it('injects and lists contexts', async () => {
    await fetch(`${baseUrl}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'test-ctx', content: 'hello', source: 'user' }),
    });

    const res = await fetch(`${baseUrl}/contexts`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ label: string }>;
    expect(body.some((c) => c.label === 'test-ctx')).toBe(true);
  });

  it('removes context by label', async () => {
    const res = await fetch(`${baseUrl}/contexts/test-ctx`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/contexts`);
    const body = await listRes.json() as Array<{ label: string }>;
    expect(body.some((c) => c.label === 'test-ctx')).toBe(false);
  });

  it('returns 404 for missing context', async () => {
    const res = await fetch(`${baseUrl}/contexts/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('GET /runs/:id', () => {
  it('returns 404 for unknown run', async () => {
    const res = await fetch(`${baseUrl}/runs/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});
