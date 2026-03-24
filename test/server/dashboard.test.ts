import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(new InstructionLoop());
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

describe('GET /dashboard', () => {
  it('includes the runs link in top nav', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('href="/runs"');
    expect(html).toContain('>Runs<');
  });

  it('includes delete chat controls', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-chat-header-action="delete"');
  });

  it('includes the run debug modal shell', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="runDebugModal"');
  });

  it('persists the selected mode across reloads', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('shipyard_dashboard_mode');
    expect(html).toContain('restoreDashboardModeSel');
    expect(html).toContain('persistDashboardModeSel');
  });

  it('keeps send and stop as separate controls', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="stopBtn"');
    expect(html).not.toContain("btn.dataset.action = 'stop'");
  });

  it('uses the selected mode to decide whether a thread is a follow-up target', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('return uiEl.value === r.threadKind;');
  });

  it('includes current model settings in ask follow-up requests', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("var followupBody = { instruction: inst }");
    expect(html).toContain("followupBody.modelFamily = followupPrefs.family");
    expect(html).toContain("followupBody.models = followupPrefs.models");
  });
});
