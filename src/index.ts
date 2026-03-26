/**
 * Shipyard server entry point.
 *
 * Autonomous coding agent powered by LangGraph.
 * Runs on port 4200 (configurable via SHIPYARD_PORT).
 */

import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { InstructionLoop } from './runtime/loop.js';
import { attachWebSocket } from './server/ws.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const loop = new InstructionLoop();

// Optional: wire pg Pool for persistence if DB URL is configured
if (env.SHIPYARD_DB_URL) {
  import('pg').then(({ default: pg }) => {
    const pool = new pg.Pool({ connectionString: env.SHIPYARD_DB_URL });
    pool.query('SELECT 1').then(() => {
      loop.setPool(pool);
      console.log('  DB:        connected (persistence enabled)');
    }).catch(() => {
      console.log('  DB:        not available (in-memory only)');
    });
  }).catch(() => {
    console.log('  DB:        pg module not available (in-memory only)');
  });
}

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
