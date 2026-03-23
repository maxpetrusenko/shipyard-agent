/**
 * REST API routes for the Shipyard agent server.
 */

import { Router, json } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';

export function createRoutes(loop: InstructionLoop): Router {
  const router = Router();
  router.use(json());

  // POST /run - Submit a new instruction
  router.post('/run', (req, res) => {
    const { instruction, contexts } = req.body as {
      instruction?: string;
      contexts?: Array<{ label: string; content: string; source?: string }>;
    };

    if (!instruction) {
      res.status(400).json({ error: 'instruction is required' });
      return;
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
  });

  // POST /inject - Inject context mid-run
  router.post('/inject', (req, res) => {
    const { label, content, source } = req.body as {
      label?: string;
      content?: string;
      source?: string;
    };

    if (!label || !content) {
      res.status(400).json({ error: 'label and content are required' });
      return;
    }

    loop.injectContext({
      label,
      content,
      source: (source as 'user' | 'tool' | 'system') ?? 'user',
    });

    res.json({ success: true });
  });

  // POST /cancel - Cancel current run
  router.post('/cancel', (_req, res) => {
    const cancelled = loop.cancel();
    res.json({ cancelled });
  });

  // GET /status - Get queue status
  router.get('/status', (_req, res) => {
    res.json(loop.getStatus());
  });

  // GET /runs - List all runs
  router.get('/runs', (_req, res) => {
    res.json(loop.getAllRuns());
  });

  // GET /runs/:id - Get specific run
  router.get('/runs/:id', (req, res) => {
    const run = loop.getRun(req.params['id']!);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  });

  // GET /health - Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  return router;
}
