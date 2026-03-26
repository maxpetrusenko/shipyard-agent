import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';
import {
  getSettingsModalHtml,
  getSettingsModalStyles,
  getSettingsModalScript,
} from '../../src/server/dashboard-settings.js';

/* ---- Unit tests (HTML / CSS / JS output) ---- */

describe('Settings modal — Ack Comment Template (unit)', () => {
  it('HTML contains ackTemplateInput textarea', () => {
    const html = getSettingsModalHtml();
    expect(html).toContain('id="ackTemplateInput"');
    expect(html).toContain('<textarea');
  });

  it('HTML contains preview and save buttons', () => {
    const html = getSettingsModalHtml();
    expect(html).toContain('data-action="previewAckTemplate"');
    expect(html).toContain('data-action="saveAckTemplate"');
  });

  it('HTML contains ackTemplatePreview div', () => {
    const html = getSettingsModalHtml();
    expect(html).toContain('id="ackTemplatePreview"');
  });

  it('CSS contains .ack-preview class', () => {
    const css = getSettingsModalStyles();
    expect(css).toContain('.ack-preview');
  });

  it('CSS contains #ackTemplateInput min-height', () => {
    const css = getSettingsModalStyles();
    expect(css).toContain('#ackTemplateInput');
    expect(css).toContain('min-height');
  });

  it('JS contains previewAckTemplate function', () => {
    const js = getSettingsModalScript();
    expect(js).toContain('function previewAckTemplate');
  });

  it('JS contains saveAckTemplate function', () => {
    const js = getSettingsModalScript();
    expect(js).toContain('function saveAckTemplate');
  });

  it('JS contains loadAckTemplate function', () => {
    const js = getSettingsModalScript();
    expect(js).toContain('function loadAckTemplate');
  });

  it('handleSettingsAction dispatches previewAckTemplate', () => {
    const js = getSettingsModalScript();
    expect(js).toMatch(/previewAckTemplate.*return true/);
  });

  it('handleSettingsAction dispatches saveAckTemplate', () => {
    const js = getSettingsModalScript();
    expect(js).toMatch(/saveAckTemplate.*return true/);
  });
});

/* ---- HTTP integration tests ---- */

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

describe('GET /api/settings/ack-template', () => {
  it('returns default template', async () => {
    const res = await fetch(`${baseUrl}/api/settings/ack-template`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('template');
    expect(typeof body.template).toBe('string');
    expect(body.template.length).toBeGreaterThan(0);
  });
});

describe('POST /api/settings/ack-template', () => {
  it('stores template and returns ok', async () => {
    const customTpl = 'Custom: {{repo}} {{issue}} {{runId}} {{status}}';
    const res = await fetch(`${baseUrl}/api/settings/ack-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ template: customTpl }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify GET reflects the new value
    const res2 = await fetch(`${baseUrl}/api/settings/ack-template`);
    const body2 = await res2.json();
    expect(body2.template).toBe(customTpl);
  });

  it('rejects non-string template', async () => {
    const res = await fetch(`${baseUrl}/api/settings/ack-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ template: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
