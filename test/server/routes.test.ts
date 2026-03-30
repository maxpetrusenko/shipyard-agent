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

  it('echoes project context on accepted runs', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'test instruction with project',
        projectContext: { projectId: 'ship-agent', projectLabel: 'Ship Agent' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      projectContext: { projectId: string; projectLabel: string } | null;
    };
    expect(body.runId).toBeTruthy();
    expect(body.projectContext).toEqual({ projectId: 'ship-agent', projectLabel: 'Ship Agent' });

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      projectContext: { projectId: string; projectLabel: string } | null;
    };
    expect(runBody.projectContext).toEqual({ projectId: 'ship-agent', projectLabel: 'Ship Agent' });
  });

  it('stores and returns explicit run lineage ids', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'lineage test run',
        campaignId: 'campaign-123',
        rootRunId: 'root-456',
        parentRunId: 'parent-789',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      campaignId: string | null;
      rootRunId: string | null;
      parentRunId: string | null;
    };
    expect(body.runId).toBeTruthy();
    expect(body.campaignId).toBe('campaign-123');
    expect(body.rootRunId).toBe('root-456');
    expect(body.parentRunId).toBe('parent-789');

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      campaignId: string | null;
      rootRunId: string | null;
      parentRunId: string | null;
    };
    expect(runBody.campaignId).toBe('campaign-123');
    expect(runBody.rootRunId).toBe('root-456');
    expect(runBody.parentRunId).toBe('parent-789');
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

    const runRes = await fetch(`${baseUrl2}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(runBody.modelOverride).toBe('gpt-5.4-mini');
    expect(runBody.resolvedModels.coding).toBe('gpt-5.4-mini');
    expect(runBody.resolvedModels.planning).toBe('gpt-5.4-mini');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  }, 15_000);

  it('canonicalizes stale codex overrides before queuing a run', async () => {
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
        model: 'gpt-5.3-codex',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();

    await new Promise((r) => setTimeout(r, 50));

    const runRes = await fetch(`${baseUrl2}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(runBody.modelOverride).toBe('gpt-5.4');
    expect(runBody.resolvedModels.planning).toBe('gpt-5.4');
    expect(runBody.resolvedModels.coding).toBe('gpt-5.4');

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

  it('accepts supplied execution plans and disables confirm-plan waits', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'execute rebuild plan',
        uiMode: 'plan',
        confirmPlan: true,
        executionPlan: [
          { description: 'refactor api', files: ['/repo/api.ts'] },
          { description: 'refactor web', files: ['/repo/web.ts'] },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      confirmPlan: boolean;
      runMode: string;
    };
    expect(body.runId).toBeTruthy();
    expect(body.confirmPlan).toBe(false);
    expect(body.runMode).toBe('code');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      steps: Array<{ description: string }>;
    };
    expect(runBody.steps.map((step) => step.description)).toEqual(['refactor api', 'refactor web']);
  });

  it('accepts planDoc and creates run successfully', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'rebuild with PRD',
        planDoc: '# Ship PRD\n\nBuild a collaborative editor.',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();
  });

  it('derives an execution plan from structured agent instructions', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: `Execution plan
1. Build API routes
2. Add dashboard tests`,
        uiMode: 'agent',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      confirmPlan: boolean;
      runMode: string;
      requestedUiMode: string | null;
    };
    expect(body.runId).toBeTruthy();
    expect(body.confirmPlan).toBe(false);
    expect(body.runMode).toBe('code');
    expect(body.requestedUiMode).toBe('agent');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      steps: Array<{ description: string }>;
      phase: string;
    };
    expect(runBody.steps.map((step) => step.description)).toEqual([
      'Build API routes',
      'Add dashboard tests',
    ]);
    expect(runBody.phase).not.toBe('awaiting_confirmation');
  });

  it('uses attached plan docs as execution guidance instead of awaiting plan confirmation', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'ship this PRD',
        uiMode: 'plan',
        planDoc: '# Plan\n\n1. Update API\n2. Update dashboard',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      confirmPlan: boolean;
      runMode: string;
      requestedUiMode: string | null;
    };
    expect(body.runId).toBeTruthy();
    expect(body.confirmPlan).toBe(false);
    expect(body.runMode).toBe('code');
    expect(body.requestedUiMode).toBe('agent');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      phase: string;
      requestedUiMode: string | null;
    };
    expect(runBody.phase).not.toBe('awaiting_confirmation');
    expect(runBody.requestedUiMode).toBe('agent');
  });

  it('treats agent-mode plan docs as code runs and derives execution steps', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'build ship app from attached plan',
        uiMode: 'agent',
        planDoc: '# Ship Rebuild\n\nVertical 1: Database schema and migrations\nVertical 2: Auth and session management\nVertical 3: Document CRUD API',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      confirmPlan: boolean;
      runMode: string;
      requestedUiMode: string | null;
    };
    expect(body.runId).toBeTruthy();
    expect(body.confirmPlan).toBe(false);
    expect(body.runMode).toBe('code');
    expect(body.requestedUiMode).toBe('agent');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      steps: Array<{ description: string }>;
    };
    expect(runBody.steps.map((step) => step.description)).toEqual([
      'Database schema and migrations',
      'Auth and session management',
      'Document CRUD API',
    ]);
  });

  it('rejects planDoc exceeding max size (500KB)', async () => {
    const hugeDoc = 'x'.repeat(500 * 1024 + 1);
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'rebuild',
        planDoc: hugeDoc,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('planDoc exceeds max size');
  });

  it('parses Phase headings with period separator and 0-based numbering', async () => {
    const prdDoc = [
      '## Phase 0. Baseline and foundations',
      '## Phase 1. Database schema',
      '## Phase 2. Auth and sessions',
      '## Phase 3. Document CRUD',
    ].join('\n\n### Goal\n\nDo the thing.\n\n');
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'rebuild from PRD',
        planDoc: prdDoc,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      steps: Array<{ index: number; description: string }>;
    };
    expect(runBody.steps).toHaveLength(4);
    expect(runBody.steps.map((s) => s.description)).toEqual([
      'Baseline and foundations',
      'Database schema',
      'Auth and sessions',
      'Document CRUD',
    ]);
    // Indexes should be 0-based and sequential
    expect(runBody.steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('accepts workDir override to target a different directory', async () => {
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'build the app',
        workDir: '/tmp/test-target-dir',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { runId: string };
    expect(body.runId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 25));

    const runRes = await fetch(`${baseUrl}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as { workDir: string };
    expect(runBody.workDir).toBe('/tmp/test-target-dir');
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

  it('keeps requested agent ui mode visible in stored runs even when execution resolves to ask', async () => {
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

    const runRes = await fetch(`${baseUrl2}/runs/${body.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      requestedUiMode: string | null;
      runMode: string | null;
      threadKind: string | null;
      executionPath: string | null;
    };
    expect(runBody.requestedUiMode).toBe('agent');
    expect(runBody.runMode).toBe('auto');
    expect(runBody.threadKind).toBe('ask');
    expect(runBody.executionPath).toBe('local-shortcut');

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

    const runRes = await fetch(`${baseUrl2}/runs/${created.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(runBody.modelOverride).toBe('gpt-5.4-mini');
    expect(runBody.resolvedModels.chat).toBe('gpt-5.4-mini');

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

    const runRes = await fetch(`${baseUrl2}/runs/${created.runId}`);
    expect(runRes.status).toBe(200);
    const runBody = await runRes.json() as {
      modelOverride: string | null;
      resolvedModels: Record<string, string>;
    };
    expect(runBody.modelOverride).toBeNull();
    expect(runBody.resolvedModels.chat).toBe('gpt-5.4-mini');

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

    const run = loop2.getRun(created.runId);
    expect(run?.rootRunId).toBe(created.runId);
    expect(run?.campaignId).toBe(created.runId);
    expect(run?.parentRunId).toBeNull();

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('derives a supplied plan for agent follow-ups and skips confirm waits', async () => {
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
        instruction: `Execution plan
1. Update routes
2. Add tests`,
        uiMode: 'agent',
      }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    const run = loop2.getRun(created.runId);
    expect(run?.threadKind).toBe('agent');
    expect(run?.runMode).toBe('code');
    expect(run?.steps.map((step) => step.description)).toEqual(['Update routes', 'Add tests']);
    expect(run?.phase).not.toBe('awaiting_confirmation');

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
    expect(run?.modelOverride).toBe('gpt-5.4-mini');

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

  it('returns the stored run payload for a known run', async () => {
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

    const res = await fetch(`${baseUrl2}/runs/${created.runId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      runId: string;
      executionPath: string;
      traceUrl: string | null;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.runId).toBe(created.runId);
    expect(body.executionPath).toBe('local-shortcut');
    expect(body.traceUrl).toBeNull();
    expect(body.messages[0]?.role).toBe('user');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });

  it('returns the compact debug snapshot for a known run', async () => {
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
      localTraceUrl: string;
      openTraceUrl: string;
      traceUrl: string | null;
      instruction: string;
    };
    expect(body.runId).toBe(created.runId);
    expect(body.localTraceUrl).toBe(`/api/runs/${created.runId}/debug`);
    expect(body.openTraceUrl).toBe(`/api/runs/${created.runId}/debug`);
    expect(body.traceUrl).toBeNull();
    expect(body.instruction).toBe('hi');

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
