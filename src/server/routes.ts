/**
 * REST API routes for the Shipyard agent server.
 */

import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { InstructionLoop } from '../runtime/loop.js';
import type { ModelRole } from '../config/model-policy.js';
import type { RunResult } from '../runtime/loop.js';
import { buildRunDebugSnapshot } from './run-debug.js';
import { WORK_DIR, setWorkDir } from '../config/work-dir.js';
import { resetClient } from '../config/client.js';
import { resetOpenAIClient } from '../config/openai-client.js';
import {
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  rollbackWorkspaceCheckpoint,
} from '../runtime/checkpoints.js';
import {
  cloneOrUpdateGithubRepo,
  createInstallationTokenById,
  githubAppConfigured,
  githubCliAuthStatus,
  listGithubReposForInstallation,
} from './github-connect.js';
import {
  buildGithubInstallStartUrl,
  clearSessionGithub,
  getSessionGithubInstallationId,
  getOrCreateOAuthSession,
  githubAppSlug,
  githubInstallConfigured,
  setSessionGithubInstallation,
} from './github-oauth.js';

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
    nextActions: run.nextActions ?? [],
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

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function installPopupHtml(ok: boolean, message: string): string {
  const payload = JSON.stringify({
    type: 'shipyard_github_install',
    ok,
    message,
  }).replace(/</g, '\\u003c');
  const title = ok ? 'GitHub connected' : 'GitHub connection failed';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:ui-monospace,Menlo,monospace;padding:20px;background:#0b1020;color:#e2e8f0"><div>${title}. You can close this window.</div><script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload}, window.location.origin);}}catch(e){}setTimeout(function(){window.close();},120);</script></body></html>`;
}

export function createRoutes(loop: InstructionLoop): Router {
  const router = Router();
  router.use(json({ limit: '1mb' }));

  function currentRepoStatus(): { branch: string | null; remote: string | null } {
    try {
      const branch = execSync(`git -C "${WORK_DIR}" branch --show-current`, { encoding: 'utf-8' }).trim() || null;
      const remote = execSync(`git -C "${WORK_DIR}" remote get-url origin`, { encoding: 'utf-8' }).trim() || null;
      return { branch, remote };
    } catch {
      return { branch: null, remote: null };
    }
  }

  function resolveGithubInstallation(req: Request, res: Response): number | null {
    const session = getOrCreateOAuthSession(req, res);
    return getSessionGithubInstallationId(session);
  }

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
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const { instruction, model, modelFamily, models } = payload as {
      instruction?: string;
      model?: string | null;
      modelFamily?: string | null;
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
    const replaceModelSelection =
      hasOwn(payload, 'model') ||
      hasOwn(payload, 'modelFamily') ||
      hasOwn(payload, 'models');
    const ok = loop.followUpThread(req.params['id'] as string, instruction, {
      modelOverride:
        typeof model === 'string' ? model.trim() || undefined : undefined,
      modelFamily: fam,
      modelOverrides,
      replaceModelSelection,
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

  // GET /checkpoints - list latest workspace checkpoints
  router.get('/checkpoints', wrap((req, res) => {
    const limitRaw = parseInt(String(req.query['limit'] ?? '20'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    res.json({ checkpoints: listWorkspaceCheckpoints(limit) });
  }));

  // POST /checkpoints - create checkpoint for latest edited run or explicit run
  router.post('/checkpoints', wrap((req, res) => {
    const { runId, label, filePaths } = (req.body ?? {}) as {
      runId?: string;
      label?: string;
      filePaths?: string[];
    };
    const out = createWorkspaceCheckpoint({
      run_id: runId,
      label,
      file_paths: Array.isArray(filePaths) ? filePaths : undefined,
    });
    if (!out.success) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
  }));

  // POST /checkpoints/rollback - restore checkpoint
  router.post('/checkpoints/rollback', wrap((req, res) => {
    const { checkpointId, dryRun, filePaths } = (req.body ?? {}) as {
      checkpointId?: string;
      dryRun?: boolean;
      filePaths?: string[];
    };
    if (!checkpointId || !checkpointId.trim()) {
      res.status(400).json({ error: 'checkpointId is required' });
      return;
    }
    const out = rollbackWorkspaceCheckpoint({
      checkpoint_id: checkpointId.trim(),
      dry_run: Boolean(dryRun),
      file_paths: Array.isArray(filePaths) ? filePaths : undefined,
    });
    if (!out.success) {
      res.status(400).json(out);
      return;
    }
    res.json(out);
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

  // GET /github/install/start - start proper GitHub App installation flow
  router.get('/github/install/start', wrap((req, res) => {
    if (!githubInstallConfigured()) {
      res.status(400).send(
        installPopupHtml(
          false,
          'GitHub App install is not configured. Set GITHUB_APP_SLUG and GitHub App Setup URL.',
        ),
      );
      return;
    }
    const session = getOrCreateOAuthSession(req, res);
    const installUrl = buildGithubInstallStartUrl(session);
    res.redirect(installUrl);
  }));

  // GET /github/install/callback - receives installation_id from GitHub App setup URL
  router.get('/github/install/callback', wrap(async (req, res) => {
    const session = getOrCreateOAuthSession(req, res);
    const installationIdRaw = Number(String(req.query['installation_id'] ?? '0'));
    const state = String(req.query['state'] ?? '');
    if (!installationIdRaw) {
      res.status(400).type('html').send(installPopupHtml(false, 'Missing installation_id in callback.'));
      return;
    }
    if (session.pendingState && state && session.pendingState !== state) {
      res.status(400).type('html').send(installPopupHtml(false, 'Invalid install state.'));
      return;
    }
    session.pendingState = undefined;
    setSessionGithubInstallation(session, installationIdRaw);

    const appToken = await createInstallationTokenById(installationIdRaw);
    if (!appToken) {
      res.status(400).type('html').send(installPopupHtml(false, 'GitHub App installed, but token exchange failed. Check GITHUB_APP_CLIENT_ID (or GITHUB_APP_ID) / GITHUB_APP_PRIVATE_KEY.'));
      return;
    }
    res.status(200).type('html').send(installPopupHtml(true, 'GitHub App installed.'));
  }));

  // POST /github/install/logout - clear current GitHub App install session
  router.post('/github/install/logout', wrap((req, res) => {
    const session = getOrCreateOAuthSession(req, res);
    clearSessionGithub(session);
    res.json({ ok: true });
  }));

  // GET /settings/status - active repo + provider key availability
  router.get('/settings/status', wrap(async (req, res) => {
    const repo = currentRepoStatus();
    const session = getOrCreateOAuthSession(req, res);
    const installationId = getSessionGithubInstallationId(session);
    res.json({
      workDir: WORK_DIR,
      workDirExists: existsSync(WORK_DIR),
      repoBranch: repo.branch,
      repoRemote: repo.remote,
      hasAnthropicApiKey: Boolean(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']),
      hasOpenAIApiKey: Boolean(process.env['OPENAI_API_KEY']),
      ghAuthenticated: await githubCliAuthStatus(),
      githubInstallConfigured: githubInstallConfigured(),
      githubAppConfigured: githubAppConfigured(),
      githubAppSlug: githubAppSlug() || null,
      githubConnected: Boolean(installationId),
      githubInstallationId: installationId,
    });
  }));

  // POST /settings/model-keys - update in-memory provider keys for this server process
  router.post('/settings/model-keys', wrap((req, res) => {
    const { anthropicApiKey, anthropicAuthToken, openaiApiKey } = (req.body ?? {}) as {
      anthropicApiKey?: string;
      anthropicAuthToken?: string;
      openaiApiKey?: string;
    };

    if (typeof anthropicApiKey === 'string') {
      process.env['ANTHROPIC_API_KEY'] = anthropicApiKey.trim();
      if (anthropicApiKey.trim()) {
        delete process.env['ANTHROPIC_AUTH_TOKEN'];
      }
    }
    if (typeof anthropicAuthToken === 'string') {
      process.env['ANTHROPIC_AUTH_TOKEN'] = anthropicAuthToken.trim();
      if (anthropicAuthToken.trim()) {
        delete process.env['ANTHROPIC_API_KEY'];
      }
    }
    if (typeof openaiApiKey === 'string') {
      process.env['OPENAI_API_KEY'] = openaiApiKey.trim();
    }

    resetClient();
    resetOpenAIClient();

    res.json({
      ok: true,
      hasAnthropicApiKey: Boolean(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']),
      hasOpenAIApiKey: Boolean(process.env['OPENAI_API_KEY']),
    });
  }));

  // POST /github/repos - list accessible repos for connected installation only
  router.post('/github/repos', wrap(async (req, res) => {
    const { query } = (req.body ?? {}) as { query?: string };
    const installationId = resolveGithubInstallation(req, res);
    if (!installationId) {
      res.status(401).json({ error: 'Not connected to GitHub App. Click Connect GitHub first.' });
      return;
    }
    const repos = await listGithubReposForInstallation(installationId, query);
    res.json({ repos, authSource: 'installation' });
  }));

  // POST /github/connect - clone/pull a repo locally and switch active WORK_DIR (installation only)
  router.post('/github/connect', wrap(async (req, res) => {
    const { repoFullName } = (req.body ?? {}) as {
      repoFullName?: string;
    };
    const installationId = resolveGithubInstallation(req, res);
    if (!installationId) {
      res.status(401).json({ error: 'Not connected to GitHub App. Click Connect GitHub first.' });
      return;
    }
    if (!repoFullName || typeof repoFullName !== 'string' || !repoFullName.includes('/')) {
      res.status(400).json({ error: 'repoFullName must be owner/repo' });
      return;
    }

    const [owner, repo] = repoFullName.split('/', 2);
    if (!owner || !repo) {
      res.status(400).json({ error: 'repoFullName must be owner/repo' });
      return;
    }

    const reposRoot = path.resolve(process.cwd(), 'Sessions', 'connected-repos');
    const cloned = await cloneOrUpdateGithubRepo('', owner, repo, reposRoot, installationId);
    setWorkDir(cloned.workDir);

    res.json({
      ok: true,
      workDir: cloned.workDir,
      branch: cloned.branch,
      repoFullName: `${owner}/${repo}`,
      githubInstallationId: installationId,
      authSource: 'installation',
    });
  }));

  // GET /health - Health check
  router.get('/health', wrap((_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  }));

  return router;
}
