import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { InstructionLoop } from '../src/runtime/loop.js';
import { attachWebSocket } from '../src/server/ws.js';

interface TestContext {
  server: Server;
  wsUrl: string;
  loop: InstructionLoop;
}

async function setup(): Promise<TestContext> {
  const loop = new InstructionLoop();
  const app = createApp(loop);
  const server = createServer(app);
  attachWebSocket(server, loop);

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve(addr.port);
    });
  });

  return { server, wsUrl: `ws://127.0.0.1:${port}/ws`, loop };
}

async function teardown(ctx: TestContext): Promise<void> {
  ctx.server.closeAllConnections?.();
  await new Promise<void>((r) => {
    ctx.server.close(() => r());
    setTimeout(r, 300);
  });
}

/** Create WS and collect messages into a buffer. Returns ws + first message promise. */
function createClient(url: string): {
  ws: WebSocket;
  nextMessage: () => Promise<Record<string, unknown>>;
} {
  const ws = new WebSocket(url);
  const messageQueue: Record<string, unknown>[] = [];
  const waiters: Array<(msg: Record<string, unknown>) => void> = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      messageQueue.push(msg);
    }
  });

  function nextMessage(): Promise<Record<string, unknown>> {
    const queued = messageQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS message timeout')), 10_000);
      waiters.push((msg) => { clearTimeout(t); resolve(msg); });
    });
  }

  return { ws, nextMessage };
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), 10_000);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

describe('WebSocket', () => {
  it('receives status on connect', async () => {
    const ctx = await setup();
    try {
      const { ws, nextMessage } = createClient(ctx.wsUrl);
      await waitOpen(ws);
      const msg = await nextMessage();
      expect(msg.type).toBe('status');
      expect(msg.data).toBeTruthy();
      ws.close();
    } finally {
      await teardown(ctx);
    }
  });

  it('handles status request', async () => {
    const ctx = await setup();
    try {
      const { ws, nextMessage } = createClient(ctx.wsUrl);
      await waitOpen(ws);
      await nextMessage(); // initial status
      ws.send(JSON.stringify({ type: 'status' }));
      const msg = await nextMessage();
      expect(msg.type).toBe('status');
      ws.close();
    } finally {
      await teardown(ctx);
    }
  });

  it('handles submit and returns runId', async () => {
    const ctx = await setup();
    try {
      const { ws, nextMessage } = createClient(ctx.wsUrl);
      await waitOpen(ws);
      await nextMessage(); // initial status
      ws.send(JSON.stringify({ type: 'submit', instruction: 'test ws instruction' }));
      // May receive state_update broadcasts before the submitted ack
      let msg = await nextMessage();
      while (msg.type === 'state_update') {
        msg = await nextMessage();
      }
      expect(msg.type).toBe('submitted');
      expect(msg.runId).toBeTruthy();
      ws.close();
    } finally {
      await teardown(ctx);
    }
  }, 15_000);

  it('returns error on invalid JSON', async () => {
    const ctx = await setup();
    try {
      const { ws, nextMessage } = createClient(ctx.wsUrl);
      await waitOpen(ws);
      await nextMessage(); // initial status
      ws.send('not json');
      const msg = await nextMessage();
      expect(msg.type).toBe('error');
      ws.close();
    } finally {
      await teardown(ctx);
    }
  });
});
