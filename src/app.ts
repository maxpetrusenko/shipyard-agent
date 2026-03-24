/**
 * Express application factory.
 *
 * Includes optional Bearer token auth, simple rate limiting,
 * and a global error handler.
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createRoutes } from './server/routes.js';
import { heroHandler } from './server/hero.js';
import { dashboardHandler } from './server/dashboard.js';
import { benchmarksHandler } from './server/benchmarks.js';
import { runsHandler } from './server/runs.js';
import { settingsHandler } from './server/settings.js';
import { createBenchmarkRoutes } from './server/benchmark-api.js';
import type { InstructionLoop } from './runtime/loop.js';

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, no deps)
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

function createRateLimiter(windowMs: number) {
  const buckets = new Map<string, RateBucket>();

  return function rateLimit(limit: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const now = Date.now();
      let bucket = buckets.get(ip);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(ip, bucket);
      }
      bucket.count++;
      if (bucket.count > limit) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      next();
    };
  };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(loop: InstructionLoop): express.Application {
  const app = express();

  // CORS for local development
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Optional Bearer token auth (skip /api/health)
  const apiKey = process.env['SHIPYARD_API_KEY'];
  if (apiKey) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') { next(); return; }
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${apiKey}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Rate limiting: POST /run = 10/min, others = 60/min
  const limiter = createRateLimiter(60_000);
  app.post('/api/run', limiter(10));
  app.use('/api', limiter(60));

  // Hero landing at root, dashboard at /dashboard
  app.get('/', heroHandler());
  app.get('/dashboard', dashboardHandler(loop));
  app.get('/runs', runsHandler(loop));
  app.get('/settings', settingsHandler());
  app.get('/benchmarks', benchmarksHandler());

  app.use('/api', createRoutes(loop));
  app.use('/api', createBenchmarkRoutes());

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
