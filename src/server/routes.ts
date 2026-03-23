/**
 * REST API routes for the Shipyard agent server.
 */

import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';

const MAX_INSTRUCTION_SIZE = 100 * 1024; // 100 KB
const MAX_CONTEXT_SIZE = 500 * 1024;     // 500 KB

/** Wrap async route handlers so uncaught errors become 500s. */
function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export function createRoutes(loop: InstructionLoop): Router {
  const router = Router();
  router.use(json({ limit: '1mb' }));

  // POST /run - Submit a new instruction
  router.post('/run', wrap((req, res) => {
    const { instruction, contexts } = req.body as {
      instruction?: string;
      contexts?: Array<{ label: string; content: string; source?: string }>;
    };

    if (!instruction) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }

    if (Buffer.byteLength(instruction, 'utf-8') > MAX_INSTRUCTION_SIZE) {
      res.status(400).json({ error: `instruction exceeds max size (${MAX_INSTRUCTION_SIZE} bytes)` });
      return;
    }

    if (contexts) {
      for (const c of contexts) {
        if (Buffer.byteLength(c.content ?? '', 'utf-8') > MAX_CONTEXT_SIZE) {
          res.status(400).json({ error: `context "${c.label}" exceeds max size (${MAX_CONTEXT_SIZE} bytes)` });
          return;
        }
      }
    }

    const id = loop.submit(
      instruction,
      contexts?.map((c) => ({
        label: c.label,
        content: c.content,
        source: (c.source as 'user' | 'tool' | 'system') ?? 'user',
      })),
    );

    res.json({ runId: id });
  }));

  // POST /inject - Inject context mid-run
  router.post('/inject', wrap((req, res) => {
    const { label, content, source } = req.body as {
      label?: string;
      content?: string;
      source?: string;
    };

    if (!label || !content) {
      res.status(400).json({ error: 'label and content are required' });
      return;
    }

    if (Buffer.byteLength(content, 'utf-8') > MAX_CONTEXT_SIZE) {
      res.status(400).json({ error: `context exceeds max size (${MAX_CONTEXT_SIZE} bytes)` });
      return;
    }

    loop.injectContext({
      label,
      content,
      source: (source as 'user' | 'tool' | 'system') ?? 'user',
    });

    res.json({ success: true });
  }));

  // POST /cancel - Cancel current run
  router.post('/cancel', wrap((_req, res) => {
    const cancelled = loop.cancel();
    res.json({ cancelled });
  }));

  // GET /status - Get queue status
  router.get('/status', wrap((_req, res) => {
    res.json(loop.getStatus());
  }));

  // GET /runs - List all runs (with optional pagination)
  router.get('/runs', wrap((req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);
    res.json(loop.getRunsPaginated(limit, offset));
  }));

  // GET /runs/:id - Get specific run
  router.get('/runs/:id', wrap((req, res) => {
    const run = loop.getRun(req.params['id'] as string);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  }));

  // GET /contexts - List active contexts
  router.get('/contexts', wrap((_req, res) => {
    res.json(loop.getContexts());
  }));

  // DELETE /contexts/:label - Remove a context by label
  router.delete('/contexts/:label', wrap((req, res) => {
    const removed = loop.removeContext(req.params['label'] as string);
    if (!removed) {
      res.status(404).json({ error: 'Context not found' });
      return;
    }
    res.json({ success: true });
  }));

  // GET /health - Health check
  router.get('/health', wrap((_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  }));

  return router;
}
