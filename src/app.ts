/**
 * Express application factory.
 */

import express from 'express';
import { createRoutes } from './server/routes.js';
import type { InstructionLoop } from './runtime/loop.js';

export function createApp(loop: InstructionLoop): express.Application {
  const app = express();

  // CORS for local development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  app.use('/api', createRoutes(loop));

  return app;
}
