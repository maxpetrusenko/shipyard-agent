/**
 * WebSocket handler: real-time state streaming + instruction submission.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { InstructionLoop } from '../runtime/loop.js';
import type { ShipyardStateType } from '../graph/state.js';

export function attachWebSocket(server: Server, loop: InstructionLoop): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Broadcast state changes to all connected clients
  const unsubscribe = loop.onStateChange((state: Partial<ShipyardStateType>) => {
    const msg = JSON.stringify({ type: 'state_update', data: state });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  wss.on('connection', (ws) => {
    // Send current status on connect
    ws.send(JSON.stringify({ type: 'status', data: loop.getStatus() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          instruction?: string;
          context?: { label: string; content: string; source?: string };
        };

        switch (msg.type) {
          case 'submit': {
            if (msg.instruction) {
              const id = loop.submit(msg.instruction);
              ws.send(JSON.stringify({ type: 'submitted', runId: id }));
            }
            break;
          }
          case 'inject': {
            if (msg.context) {
              loop.injectContext({
                label: msg.context.label,
                content: msg.context.content,
                source: (msg.context.source as 'user' | 'tool' | 'system') ?? 'user',
              });
              ws.send(JSON.stringify({ type: 'context_injected', label: msg.context.label }));
            }
            break;
          }
          case 'cancel': {
            const cancelled = loop.cancel();
            ws.send(JSON.stringify({ type: 'cancel_result', cancelled }));
            break;
          }
          case 'status': {
            ws.send(JSON.stringify({ type: 'status', data: loop.getStatus() }));
            break;
          }
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });
  });

  // Cleanup on server close
  server.on('close', () => {
    unsubscribe();
    wss.close();
  });
}
