import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';
import { WORK_DIR } from '../../src/config/work-dir.js';

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

describe('GET /benchmarks', () => {
  it('prefills snapshot capture with the current work dir', async () => {
    const res = await fetch(`${baseUrl}/benchmarks`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const escaped = WORK_DIR
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    expect(html).toContain('id="snapDir"');
    expect(html).toContain(`value="${escaped}"`);
  });
});
