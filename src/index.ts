/**
 * Shipyard server entry point.
 *
 * Autonomous coding agent powered by LangGraph + Anthropic.
 * Runs on port 4200 (configurable via SHIPYARD_PORT).
 */

import { createServer } from 'node:http';
import { createApp } from './app.js';
import { InstructionLoop } from './runtime/loop.js';
import { attachWebSocket } from './server/ws.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const loop = new InstructionLoop();
const app = createApp(loop);
const server = createServer(app);

// Attach WebSocket handler
attachWebSocket(server, loop);

server.listen(env.SHIPYARD_PORT, () => {
  console.log(`Shipyard agent server running on port ${env.SHIPYARD_PORT}`);
  console.log(`  REST:      http://localhost:${env.SHIPYARD_PORT}/api`);
  console.log(`  WebSocket: ws://localhost:${env.SHIPYARD_PORT}/ws`);
  console.log(`  Health:    http://localhost:${env.SHIPYARD_PORT}/api/health`);
  console.log(`  Tracing:   ${process.env['LANGCHAIN_TRACING_V2'] === 'true' ? 'ENABLED' : 'disabled'}`);
});

// Graceful shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`\nReceived ${sig}. Shutting down...`);
    loop.cancel();
    server.close(() => process.exit(0));
  });
}
