/**
 * WebSocket handler: real-time state streaming + instruction submission.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { InstructionLoop } from '../runtime/loop.js';
import type { ShipyardStateType } from '../graph/state.js';

/** Extended WebSocket with heartbeat tracking. */
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

export function attachWebSocket(server: Server, loop: InstructionLoop): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // --- Heartbeat: 30s ping, kill dead connections ---
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients as Set<AliveWebSocket>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  // Broadcast state changes to all connected clients
  const unsubscribe = loop.onStateChange((state: Partial<ShipyardStateType>) => {
    const msg = JSON.stringify({ type: 'state_update', data: state });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  const unsubLiveFeed = loop.onLiveFeed((event) => {
    let msg: string;
    if (event.type === 'file_edit') {
      msg = JSON.stringify({ type: 'file_edit', data: event.edit });
    } else if (event.type === 'text_chunk') {
      msg = JSON.stringify({ type: 'text_chunk', data: { node: event.node, text: event.text } });
    } else {
      msg = JSON.stringify({ type: 'tool_activity', data: event });
    }
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  wss.on('connection', (ws: AliveWebSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Send current status on connect
    ws.send(JSON.stringify({ type: 'status', data: loop.getStatus() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          instruction?: string;
          context?: { label: string; content: string; source?: string };
          runMode?: 'auto' | 'chat' | 'code';
          uiMode?: 'ask' | 'plan' | 'agent';
          confirmPlan?: boolean;
          model?: string;
          modelFamily?: 'anthropic' | 'openai';
          models?: Record<string, string>;
        };

        switch (msg.type) {
          case 'submit': {
            if (msg.instruction) {
              let mode: 'auto' | 'chat' | 'code' = msg.runMode ?? 'auto';
              let confirm = !!msg.confirmPlan;
              if (msg.uiMode === 'ask') {
                mode = 'chat';
                confirm = false;
              } else if (msg.uiMode === 'plan') {
                mode = 'code';
                confirm = true;
              } else if (msg.uiMode === 'agent') {
                mode = 'auto';
                confirm = false;
              }
              const fam =
                msg.modelFamily === 'anthropic' || msg.modelFamily === 'openai'
                  ? msg.modelFamily
                  : undefined;
              const id = loop.submit(
                msg.instruction,
                undefined,
                confirm,
                mode,
                {
                  modelOverride: msg.model?.trim() || undefined,
                  modelFamily: fam,
                  modelOverrides: msg.models,
                  requestedUiMode: msg.uiMode,
                },
              );
              ws.send(JSON.stringify({ type: 'submitted', runId: id }));
            }
            break;
          }
          case 'pause_agent': {
            loop.requestPause();
            ws.send(JSON.stringify({ type: 'pause_result', ok: true }));
            break;
          }
          case 'resume_agent': {
            loop.resumeFromPause();
            ws.send(JSON.stringify({ type: 'resume_result', ok: true }));
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
            const cancelled = loop.cancel('ws');
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
    clearInterval(heartbeatInterval);
    unsubscribe();
    unsubLiveFeed();
    wss.close();
  });
}
