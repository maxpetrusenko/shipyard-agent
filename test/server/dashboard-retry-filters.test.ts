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

describe('Retry filter bar', () => {
  it('includes the source filter dropdown', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryFilterSource"');
    expect(html).toContain('class="retry-filter-select"');
    expect(html).toContain('<option value="api">api</option>');
    expect(html).toContain('<option value="github">github</option>');
    expect(html).toContain('<option value="batch">batch</option>');
  });

  it('includes the status filter dropdown', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryFilterStatus"');
    expect(html).toContain('<option value="accepted">accepted</option>');
    expect(html).toContain('<option value="rejected">rejected</option>');
    expect(html).toContain('<option value="ignored">ignored</option>');
  });

  it('includes the event type filter input', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryFilterType"');
    expect(html).toContain('class="retry-filter-input"');
    expect(html).toContain('placeholder="Event type..."');
  });

  it('includes the apply filters button', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('data-action="applyRetryFilters"');
    expect(html).toContain('Filter</button>');
  });

  it('JS defines applyRetryFilters function', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('function applyRetryFilters()');
  });

  it('applyRetryFilters is wired into handleRetryAction', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toMatch(/applyRetryFilters.*return true/);
  });

  it('filter bar has correct CSS class', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('.retry-filter-bar{');
    expect(html).toContain('class="retry-filter-bar"');
  });
});

describe('Event detail drawer', () => {
  it('includes the drawer container element', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryDrawer"');
    expect(html).toContain('class="retry-drawer"');
  });

  it('includes the drawer body element', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryDrawerBody"');
    expect(html).toContain('class="retry-drawer-body"');
  });

  it('includes the drawer title element', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryDrawerTitle"');
    expect(html).toContain('Event Detail');
  });

  it('includes close drawer button', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('data-action="closeDrawer"');
  });

  it('JS defines openEventDrawer function', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('function openEventDrawer(eventId)');
  });

  it('JS defines closeEventDrawer function', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('function closeEventDrawer()');
  });

  it('closeDrawer action is wired into handleRetryAction', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toMatch(/closeDrawer.*closeEventDrawer/);
  });

  it('drawer CSS includes slide-in transform and open state', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('.retry-drawer{');
    expect(html).toContain('transform:translateX(100%)');
    expect(html).toContain('.retry-drawer.open{transform:translateX(0)}');
  });

  it('drawer has sticky header CSS', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('.retry-drawer-hd{');
    expect(html).toContain('position:sticky');
  });

  it('drawer body has overflow-y auto CSS', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('.retry-drawer-body{');
    expect(html).toContain('overflow-y:auto');
  });
});
