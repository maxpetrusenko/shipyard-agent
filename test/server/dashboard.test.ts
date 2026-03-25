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
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('>Settings<');
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

  it('keeps trace actions available even when only the local fallback exists', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('if (hasExternalTrace) {');
    expect(html).toContain('dbgEsc(snapshot.openTraceUrl)');
  });

  it('does not render resolved model details in the debug modal', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('Resolved models');
    expect(html).not.toContain('dbgModelsHtml(snapshot.resolvedModels)');
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

  it('uses only the composer model in follow-up requests', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("var followupBody = { instruction: inst }");
    expect(html).toContain("followupBody.model = followupModelEl.value");
    expect(html).not.toContain('shipyard_model_prefs');
    expect(html).not.toContain('followupBody.models');
  });

  it('preserves richer run history when dashboard merges updates', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('function mergeRunRecord(prev, next)');
    expect(html).toContain("if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(run.runId, merged);");
    expect(html).toContain('toolCallHistory: preferRicherArray(nextRun.toolCallHistory, prevRun.toolCallHistory)');
    expect(html).toContain('fileEdits: preferRicherArray(nextRun.fileEdits, prevRun.fileEdits)');
  });

  it('re-fetches the selected run after stop so tool history survives cancel', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("if (selectedRunId) void refreshRunDetails(selectedRunId);");
  });

  it('seeds the live timeline with the user turn and keeps it after completion', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('function seedTimelineFromMessages(runId, messages)');
    expect(html).toContain("if (typeof syncTimelineFromRun === 'function') syncTimelineFromRun(d.runId, runsMap[d.runId]);");
    expect(html).not.toContain('clearRunTimeline(s.runId);');
  });
});
