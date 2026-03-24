/**
 * REST API routes for the Shipyard agent server.
 */

import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';
import type { ModelRole } from '../config/model-policy.js';
import type { RunResult } from '../runtime/loop.js';
import { buildRunDebugSnapshot } from './run-debug.js';

const MAX_INSTRUCTION_SIZE = 100 * 1024; // 100 KB
const MAX_CONTEXT_SIZE = 500 * 1024;     // 500 KB

function immediateRunPayload(run: RunResult | undefined): Record<string, unknown> {
  if (!run || run.threadKind !== 'ask' || run.phase !== 'done') return {};
  return {
    phase: run.phase,
    threadKind: run.threadKind,
    messages: run.messages,
    traceUrl: run.traceUrl,
    tokenUsage: run.tokenUsage,
    error: run.error,
    verificationResult: run.verificationResult,
    reviewFeedback: run.reviewFeedback,
  };
}

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
    const {
      instruction,
      contexts,
      planDoc,
      confirmPlan,
      runMode,
      uiMode,
      model,
      modelFamily,
      models,
    } = req.body as {
      instruction?: string;
      contexts?: Array<{ label: string; content: string; source?: string }>;
      planDoc?: string;
      confirmPlan?: boolean;
      runMode?: string;
      /** ask | plan | agent — ask forces chat, plan forces code+confirm, agent keeps auto classification */
      uiMode?: string;
      /** Single per-run model override. */
      model?: string;
      /** anthropic | openai family presets. */
      modelFamily?: string;
      /** Per-stage model ids. */
      models?: Partial<Record<ModelRole, string>>;
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

    const allContexts = (contexts ?? []).map((c) => ({
      label: c.label,
      content: c.content,
      source: (c.source as 'user' | 'tool' | 'system') ?? 'user',
    }));

    if (planDoc && planDoc.trim()) {
      if (Buffer.byteLength(planDoc, 'utf-8') > MAX_CONTEXT_SIZE) {
        res.status(400).json({ error: `planDoc exceeds max size (${MAX_CONTEXT_SIZE} bytes)` });
        return;
      }
      allContexts.push({
        label: 'Plan Document',
        content: planDoc.trim(),
        source: 'user',
      });
    }

    let mode: 'auto' | 'chat' | 'code' = 'auto';
    let wantConfirm = !!confirmPlan;

    if (uiMode === 'ask') {
      mode = 'chat';
      wantConfirm = false;
    } else if (uiMode === 'plan') {
      mode = 'code';
      wantConfirm = true;
    } else if (uiMode === 'agent') {
      mode = 'auto';
      wantConfirm = false;
    } else if (uiMode != null && uiMode !== '') {
      res.status(400).json({ error: 'uiMode must be ask, plan, or agent' });
      return;
    } else {
      if (runMode === 'chat' || runMode === 'code' || runMode === 'auto') {
        mode = runMode;
      } else if (runMode != null && runMode !== '') {
        res.status(400).json({ error: 'runMode must be auto, chat, or code' });
        return;
      }
    }

    const fam =
      modelFamily === 'anthropic' || modelFamily === 'openai'
        ? modelFamily
        : undefined;
    const modelOverrides =
      models && typeof models === 'object' ? models : undefined;
    const id = loop.submit(instruction, allContexts, wantConfirm, mode, {
      modelOverride: model?.trim() || undefined,
      modelFamily: fam,
      modelOverrides,
    });
    const immediate = immediateRunPayload(loop.getRun(id));

    res.json({
      runId: id,
      confirmPlan: wantConfirm,
      runMode: mode,
      uiMode: uiMode ?? null,
      model: model?.trim() || null,
      modelFamily: fam ?? null,
      models: modelOverrides ?? null,
      ...immediate,
    });
  }));

  // POST /runs/:id/followup — continue an existing thread (same runId)
  router.post('/runs/:id/followup', wrap((req, res) => {
    const { instruction, model, modelFamily, models } = req.body as {
      instruction?: string;
      model?: string;
      modelFamily?: string;
      models?: Partial<Record<ModelRole, string>>;
    };
    if (!instruction || typeof instruction !== 'string') {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }
    if (Buffer.byteLength(instruction, 'utf-8') > MAX_INSTRUCTION_SIZE) {
      res.status(400).json({ error: `instruction exceeds max size (${MAX_INSTRUCTION_SIZE} bytes)` });
      return;
    }
    const fam =
      modelFamily === 'anthropic' || modelFamily === 'openai'
        ? modelFamily
        : undefined;
    const modelOverrides =
      models && typeof models === 'object' ? models : undefined;
    const ok = loop.followUpThread(req.params['id'] as string, instruction, {
      modelOverride: model?.trim() || undefined,
      modelFamily: fam,
      modelOverrides,
    });
    if (!ok) {
      res.status(400).json({
        error: 'Run not found or follow-up could not be queued',
      });
      return;
    }
    res.json({
      runId: req.params['id'],
      queued: true,
      ...immediateRunPayload(loop.getRun(req.params['id'] as string)),
    });
  }));

  // POST /agent/pause — pause between graph steps (Plan / Agent)
  router.post('/agent/pause', wrap((_req, res) => {
    const ok = loop.requestPause();
    res.json({ pauseRequested: ok });
  }));

  // POST /agent/resume — continue after pause
  router.post('/agent/resume', wrap((_req, res) => {
    loop.resumeFromPause();
    res.json({ resumed: true });
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

  // GET /runs - List all runs (with optional pagination); merges Postgres when configured
  router.get(
    '/runs',
    wrap(async (req, res) => {
      const limit = Math.min(
        Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1),
        200,
      );
      const offset = Math.max(parseInt(req.query['offset'] as string, 10) || 0, 0);
      const runs = await loop.getRunsForListingAsync(limit, offset);
      res.json(runs);
    }),
  );

  // GET /runs/:id - Get specific run
  router.get('/runs/:id', wrap((req, res) => {
    const run = loop.getRun(req.params['id'] as string);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  }));

  // GET /runs/:id/debug - Compact debug snapshot for dashboard modal
  router.get('/runs/:id/debug', wrap((req, res) => {
    const run = loop.getRun(req.params['id'] as string);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(buildRunDebugSnapshot(run));
  }));

  // DELETE /runs/:id - Remove run from server (file + optional Postgres)
  router.delete('/runs/:id', wrap(async (req, res) => {
    const result = await loop.deleteRun(req.params['id'] as string);
    if (!result.ok) {
      res
        .status(result.code === 'active' ? 409 : 404)
        .json({ error: result.error });
      return;
    }
    res.json({ ok: true });
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

  // POST /runs/:id/confirm - Confirm plan and start execution
  router.post('/runs/:id/confirm', wrap((req, res) => {
    const { editedSteps } = req.body as {
      editedSteps?: Array<{ index: number; description: string; files: string[] }>;
    };
    const confirmed = loop.confirmPlan(req.params['id'] as string, editedSteps);
    if (!confirmed) {
      res.status(404).json({ error: 'Run not found or not awaiting confirmation' });
      return;
    }
    res.json({ runId: req.params['id'], confirmed: true });
  }));

  // POST /runs/:id/resume - Resume an interrupted run
  router.post('/runs/:id/resume', wrap((req, res) => {
    const runId = loop.resume(req.params['id'] as string);
    if (!runId) {
      res.status(404).json({ error: 'Run not found or already completed' });
      return;
    }
    res.json({ runId });
  }));

  // GET /health - Health check
  router.get('/health', wrap((_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  }));

  return router;
}
