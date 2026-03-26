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

describe('Retry panel in dashboard', () => {
  it('includes the retry modal shell', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="retryModal"');
  });

  it('renders the retry events table', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryEventsBody"');
    expect(html).toContain('class="retry-tbl"');
  });

  it('includes dry run checkbox checked by default', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryDryRun"');
    expect(html).toMatch(/id="retryDryRun"\s+checked/);
  });

  it('includes max accepted input defaulting to 20', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryMaxAccepted"');
    expect(html).toContain('value="20"');
  });

  it('includes abort on queue full checkbox', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryAbortFull"');
  });

  it('has retry selected and retry all failed buttons', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('data-action="retrySelected"');
    expect(html).toContain('data-action="retryAllFailed"');
    expect(html).toContain('Retry Selected');
    expect(html).toContain('Retry All Failed');
  });

  it('has a header button to open the retry panel', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('data-action="openRetry"');
    expect(html).toContain('Retry Events');
  });

  it('JS fetches events from correct API endpoint', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain("fetch('/api/invoke/events?limit=50')");
  });

  it('JS posts retry-batch to correct API endpoint', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain("fetch('/api/invoke/events/retry-batch'");
  });

  it('includes select-all checkbox and selected count', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retrySelectAll"');
    expect(html).toContain('id="retrySelectedCount"');
  });

  it('wires retry actions into the event delegation handler', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('handleRetryAction(action)');
  });

  it('includes retry result display area', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retryResult"');
  });

  it('includes loading spinner for retry operations', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('id="retrySpinner"');
  });
});
