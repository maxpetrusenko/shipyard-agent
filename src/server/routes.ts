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
  githubAppMissingEnv,
  githubCliAuthStatus,
  listGithubAppInstallations,
  listGithubReposForInstallation,
} from './github-connect.js';
import {
  buildGithubInstallStartUrl,
  clearSessionGithub,
  githubInstallCallbackPath,
  githubInstallCallbackUrl,
  githubInstallMissingEnv,
  getSessionGithubInstallationId,
  getOrCreateOAuthSession,
  githubAppSlug,
  githubInstallConfigured,
  setSessionGithubInstallation,
} from './github-oauth.js';
import { buildRunDebugSnapshot } from './run-debug.js';
import { extractToken, hasScope, requestLooksLocal } from './auth-scopes.js';
import { registerInvokeRoutes } from './invoke-routes.js';
import { saveRawBody } from './hmac-auth.js';

const MAX_INSTRUCTION_SIZE = 100 * 1024; // 100 KB
const MAX_CONTEXT_SIZE = 500 * 1024;     // 500 KB

type ExecutionPlanInput = Array<{
  index?: number;
  description?: string;
  files?: string[];
}>;

function deriveExecutionPlanFromPlanDoc(
  planDoc: string,
): Array<{ index: number; description: string; files: string[]; status: 'pending' }> | null {
  const trimmed = planDoc.trim();
  if (!trimmed) return null;

  const verticalMatches = [...trimmed.matchAll(/^\s*(?:#+\s*)?Vertical\s+(\d+)\s*:\s*(.+?)\s*$/gim)];
  if (verticalMatches.length > 0) {
    const seen = new Set<number>();
    return verticalMatches
      .map((match, index) => {
        const parsedIndex = Number.parseInt(match[1] ?? '', 10);
        const normalizedIndex = Number.isFinite(parsedIndex) ? parsedIndex - 1 : index;
        const description = (match[2] ?? '').trim();
        return {
          index: normalizedIndex,
          description,
          files: [],
          status: 'pending' as const,
        };
      })
      .filter((step) => {
        if (!step.description || step.index < 0 || seen.has(step.index)) return false;
        seen.add(step.index);
        return true;
      })
      .sort((a, b) => a.index - b.index)
      .map((step, index) => ({ ...step, index }));
  }

  const structuredMatches = [...trimmed.matchAll(/^\s*(?:#+\s*)?(?:Phase|Task|Step)\s+(\d+)\s*:\s*(.+?)\s*$/gim)];
  if (structuredMatches.length > 0) {
    const seen = new Set<number>();
    return structuredMatches
      .map((match, index) => {
        const parsedIndex = Number.parseInt(match[1] ?? '', 10);
        const normalizedIndex = Number.isFinite(parsedIndex) ? parsedIndex - 1 : index;
        const description = (match[2] ?? '').trim();
        return {
          index: normalizedIndex,
          description,
          files: [],
          status: 'pending' as const,
        };
      })
      .filter((step) => {
        if (!step.description || step.index < 0 || seen.has(step.index)) return false;
        seen.add(step.index);
        return true;
      })
      .sort((a, b) => a.index - b.index)
      .map((step, index) => ({ ...step, index }));
  }

  const numberedMatches = [...trimmed.matchAll(/^\s*(\d+)\s*[.)]\s+(.+?)\s*$/gm)];
  const hasPlanSignals = /\b(plan|execution\s+order|steps?|phases?|tasks?|verticals?)\b/i.test(trimmed);
  if (hasPlanSignals && numberedMatches.length >= 2) {
    const seen = new Set<number>();
    return numberedMatches
      .map((match, index) => {
        const parsedIndex = Number.parseInt(match[1] ?? '', 10);
        const normalizedIndex = Number.isFinite(parsedIndex) ? parsedIndex - 1 : index;
        const description = (match[2] ?? '').trim();
        return {
          index: normalizedIndex,
          description,
          files: [],
          status: 'pending' as const,
        };
      })
      .filter((step) => {
        if (!step.description || step.index < 0 || seen.has(step.index)) return false;
        seen.add(step.index);
        return true;
      })
      .sort((a, b) => a.index - b.index)
      .map((step, index) => ({ ...step, index }));
  }

  return null;
}

function normalizeExecutionPlan(input: unknown): Array<{ index: number; description: string; files: string[]; status: 'pending' }> | null {
  if (!Array.isArray(input)) return null;
  return input.map((step, index) => {
    const record = step && typeof step === 'object' ? step as Record<string, unknown> : {};
    return {
      index: typeof record['index'] === 'number' ? record['index'] : index,
      description: typeof record['description'] === 'string' ? record['description'] : '',
      files: Array.isArray(record['files'])
        ? record['files'].filter((file): file is string => typeof file === 'string')
        : [],
      status: 'pending',
    };
  });
}

function immediateRunPayload(run: RunResult | undefined): Record<string, unknown> {
  if (!run || run.threadKind !== 'ask' || run.phase !== 'done') return {};
  return {
    phase: run.phase,
    threadKind: run.threadKind,
    campaignId: run.campaignId ?? null,
    rootRunId: run.rootRunId ?? null,
    parentRunId: run.parentRunId ?? null,
    projectContext: run.projectContext ?? null,
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>${title}</title></head><body style="font-family:ui-monospace,Menlo,monospace;padding:20px;background:#f7f5f2;color:#1a1815"><div>${title}. You can close this window.</div><script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload}, window.location.origin);}}catch(e){}setTimeout(function(){window.close();},120);</script></body></html>`;
}

export function createRoutes(loop: InstructionLoop): Router {
  const router = Router();
  router.use(json({ limit: '1mb', verify: saveRawBody }));

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

  function requireAdminRouteAccess(req: Request, res: Response): boolean {
    const token = extractToken(req);
    if (token && (hasScope(token, 'admin') || hasScope(token, 'full'))) return true;
    if (requestLooksLocal(req)) return true;
    res.status(403).json({ error: 'Admin auth required for non-local requests.' });
    return false;
  }

  // POST /run - Submit a new instruction
  router.post('/run', wrap((req, res) => {
    const {
      instruction,
      contexts,
      executionPlan,
      planDoc,
      confirmPlan,
      runMode,
      uiMode,
      model,
      modelFamily,
      models,
      campaignId,
      rootRunId,
      parentRunId,
      projectContext,
    } = req.body as {
      instruction?: string;
      contexts?: Array<{ label: string; content: string; source?: string }>;
      executionPlan?: ExecutionPlanInput;
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
      campaignId?: string | null;
      rootRunId?: string | null;
      parentRunId?: string | null;
      /** Optional project scope metadata from the dashboard. */
      projectContext?: { projectId: string; projectLabel: string };
    };

    if (!instruction) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }

    const normalizedExecutionPlan = executionPlan == null
      ? undefined
      : normalizeExecutionPlan(executionPlan);
    if (executionPlan != null && normalizedExecutionPlan == null) {
      res.status(400).json({ error: 'executionPlan must be an array of step objects' });
      return;
    }
    const executionPlanForSubmit = normalizedExecutionPlan ?? undefined;

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

    const trimmedPlanDoc = typeof planDoc === 'string' ? planDoc.trim() : '';
    const hasPlanDoc = trimmedPlanDoc.length > 0;
    const planDocExecutionPlan = hasPlanDoc && !executionPlanForSubmit
      ? deriveExecutionPlanFromPlanDoc(trimmedPlanDoc) ?? undefined
      : undefined;
    const effectiveExecutionPlan = executionPlanForSubmit ?? planDocExecutionPlan;

    if (hasPlanDoc) {
      if (Buffer.byteLength(trimmedPlanDoc, 'utf-8') > MAX_CONTEXT_SIZE) {
        res.status(400).json({ error: `planDoc exceeds max size (${MAX_CONTEXT_SIZE} bytes)` });
        return;
      }
      allContexts.push({
        label: 'Plan Document',
        content: trimmedPlanDoc,
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
      wantConfirm = !hasPlanDoc;
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

    if (hasPlanDoc && mode !== 'chat') {
      mode = 'code';
      wantConfirm = false;
    }

    if (effectiveExecutionPlan && effectiveExecutionPlan.length > 0) {
      mode = 'code';
      wantConfirm = false;
    }

    const effectiveRequestedUiMode =
      hasPlanDoc && uiMode === 'plan'
        ? 'agent'
        : (uiMode === 'ask' || uiMode === 'plan' || uiMode === 'agent' ? uiMode : undefined);

    const fam =
      modelFamily === 'anthropic' || modelFamily === 'openai'
        ? modelFamily
        : undefined;
    const modelOverrides =
      models && typeof models === 'object' ? models : undefined;
    const id = loop.submit(instruction, allContexts, wantConfirm, mode, {
      executionPlan: effectiveExecutionPlan,
      modelOverride: model?.trim() || undefined,
      modelFamily: fam,
      modelOverrides,
      requestedUiMode: effectiveRequestedUiMode,
      campaignId:
        typeof campaignId === 'string' ? campaignId.trim() || undefined : undefined,
      rootRunId:
        typeof rootRunId === 'string' ? rootRunId.trim() || undefined : undefined,
      parentRunId:
        typeof parentRunId === 'string' ? parentRunId.trim() || undefined : undefined,
      projectContext:
        projectContext &&
        typeof projectContext === 'object' &&
        typeof projectContext.projectId === 'string' &&
        typeof projectContext.projectLabel === 'string'
          ? projectContext
          : undefined,
    });
    const run = loop.getRun(id);

    // Attach project context if provided
    if (
      run &&
      projectContext &&
      typeof projectContext === 'object' &&
      typeof projectContext.projectId === 'string' &&
      typeof projectContext.projectLabel === 'string'
    ) {
      run.projectContext = projectContext;
    }

    const immediate = immediateRunPayload(run);

    res.json({
      runId: id,
      confirmPlan: wantConfirm,
      runMode: mode,
      uiMode: uiMode ?? null,
      requestedUiMode: run?.requestedUiMode ?? effectiveRequestedUiMode ?? null,
      campaignId: run?.campaignId ?? null,
      rootRunId: run?.rootRunId ?? null,
      parentRunId: run?.parentRunId ?? null,
      model: model?.trim() || null,
      modelFamily: fam ?? null,
      models: modelOverrides ?? null,
      projectContext: run?.projectContext ?? null,
      ...immediate,
    });
  }));

  // POST /runs/:id/followup — continue an existing thread (same runId)
  router.post('/runs/:id/followup', wrap((req, res) => {
    const payload = (req.body ?? {}) as Record<string, unknown>;
    const { instruction, uiMode, model, modelFamily, models } = payload as {
      instruction?: string;
      uiMode?: string | null;
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
    let threadKindHint: 'ask' | 'plan' | 'agent' | undefined;
    if (uiMode === 'ask' || uiMode === 'plan' || uiMode === 'agent') {
      threadKindHint = uiMode;
    } else if (uiMode != null && uiMode !== '') {
      res.status(400).json({ error: 'uiMode must be ask, plan, or agent' });
      return;
    }
    const replaceModelSelection =
      hasOwn(payload, 'model') ||
      hasOwn(payload, 'modelFamily') ||
      hasOwn(payload, 'models');
    const ok = loop.followUpThread(req.params['id'] as string, instruction, {
      modelOverride:
        typeof model === 'string' ? model.trim() || undefined : undefined,
      modelFamily: fam,
      modelOverrides,
      requestedUiMode: threadKindHint,
      threadKindHint,
      replaceModelSelection,
    });
    if (!ok) {
      res.status(400).json({
        error: 'Run not found or follow-up could not be queued',
      });
      return;
    }
    const run = loop.getRun(req.params['id'] as string);
    res.json({
      runId: req.params['id'],
      queued: true,
      requestedUiMode: run?.requestedUiMode ?? null,
      threadKind: run?.threadKind ?? null,
      runMode: run?.runMode ?? null,
      campaignId: run?.campaignId ?? null,
      rootRunId: run?.rootRunId ?? null,
      parentRunId: run?.parentRunId ?? null,
      projectContext: run?.projectContext ?? null,
      ...immediateRunPayload(run),
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
    const cancelled = loop.cancel('api');
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
    const run = loop.getRun(runId);
    res.json({
      runId,
      campaignId: run?.campaignId ?? null,
      rootRunId: run?.rootRunId ?? null,
      parentRunId: run?.parentRunId ?? null,
    });
  }));

  // GET /github/install/start - start proper GitHub App installation flow
  router.get('/github/install/start', wrap((req, res) => {
    const installMissing = githubInstallMissingEnv();
    if (installMissing.length > 0) {
      res.status(400).send(
        installPopupHtml(
          false,
          `GitHub App install is not configured. Missing ${installMissing.join(', ')}. Setup URL should be ${githubInstallCallbackUrl(req)}.`,
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
    if (!session.pendingState) {
      res.status(400).type('html').send(installPopupHtml(false, 'Missing or expired install state. Start the install flow again.'));
      return;
    }
    if (!state || session.pendingState !== state) {
      res.status(400).type('html').send(installPopupHtml(false, 'Invalid install state.'));
      return;
    }
    session.pendingState = undefined;
    setSessionGithubInstallation(session, installationIdRaw);

    const appMissing = githubAppMissingEnv();
    if (appMissing.length > 0) {
      res.status(400).type('html').send(installPopupHtml(false, `GitHub App installed, but token exchange is not configured on the server. Missing ${appMissing.join(', ')}.`));
      return;
    }
    const appToken = await createInstallationTokenById(installationIdRaw);
    if (!appToken) {
      res.status(400).type('html').send(installPopupHtml(false, 'GitHub App installed, but token exchange failed. Check GITHUB_APP_ID or GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY.'));
      return;
    }
    res.status(200).type('html').send(installPopupHtml(true, 'GitHub App installed.'));
  }));

  // POST /github/install/logout - clear current GitHub App install session
  router.post('/github/install/logout', wrap((req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    const session = getOrCreateOAuthSession(req, res);
    clearSessionGithub(session);
    res.json({ ok: true });
  }));

  // POST /github/installations - list app installations so UI can recover when GitHub stays on settings/installations/*
  router.post('/github/installations', wrap(async (req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    const appMissing = githubAppMissingEnv();
    if (appMissing.length > 0) {
      res.status(400).json({ error: `GitHub App token exchange is not configured. Missing ${appMissing.join(', ')}.` });
      return;
    }
    const installations = await listGithubAppInstallations();
    res.json({ installations });
  }));

  // POST /github/install/select - manually bind a visible installation to the current browser session
  router.post('/github/install/select', wrap(async (req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    const appMissing = githubAppMissingEnv();
    if (appMissing.length > 0) {
      res.status(400).json({ error: `GitHub App token exchange is not configured. Missing ${appMissing.join(', ')}.` });
      return;
    }
    const installationId = Number(String((req.body ?? {})['installationId'] ?? '0'));
    if (!installationId) {
      res.status(400).json({ error: 'installationId is required.' });
      return;
    }
    const token = await createInstallationTokenById(installationId);
    if (!token) {
      res.status(400).json({ error: `GitHub installation #${installationId} is not accessible for this app.` });
      return;
    }
    const session = getOrCreateOAuthSession(req, res);
    setSessionGithubInstallation(session, installationId);
    res.json({ ok: true, installationId });
  }));

  // GET /settings/status - active repo + provider key availability
  router.get('/settings/status', wrap(async (req, res) => {
    const repo = currentRepoStatus();
    const session = getOrCreateOAuthSession(req, res);
    const installationId = getSessionGithubInstallationId(session);
    const githubInstallMissing = githubInstallMissingEnv();
    const githubAppMissing = githubAppMissingEnv();
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
      githubInstallMissing,
      githubAppMissing,
      githubAppSlug: githubAppSlug() || null,
      githubInstallCallbackPath: githubInstallCallbackPath(),
      githubInstallCallbackUrl: githubInstallCallbackUrl(req),
      githubConnected: Boolean(installationId),
      githubInstallationId: installationId,
    });
  }));

  // POST /settings/model-keys - update in-memory provider keys for this server process
  router.post('/settings/model-keys', wrap((req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    if ((req.headers['x-requested-with'] as string | undefined) !== 'XMLHttpRequest') {
      res.status(403).json({ error: 'Forbidden: missing X-Requested-With: XMLHttpRequest' });
      return;
    }
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

  // POST /settings/github-app - update GitHub App config in process env
  router.post('/settings/github-app', wrap((req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    if ((req.headers['x-requested-with'] as string | undefined) !== 'XMLHttpRequest') {
      res.status(403).json({ error: 'Forbidden: missing X-Requested-With: XMLHttpRequest' });
      return;
    }
    const { slug, appId, privateKey } = (req.body ?? {}) as {
      slug?: string;
      appId?: string;
      privateKey?: string;
    };
    if (typeof slug === 'string') process.env['GITHUB_APP_SLUG'] = slug.trim();
    if (typeof appId === 'string') process.env['GITHUB_APP_ID'] = appId.trim();
    if (typeof privateKey === 'string') process.env['GITHUB_APP_PRIVATE_KEY'] = privateKey.trim();
    res.json({ ok: true });
  }));

  // POST /github/repos - list accessible repos for connected installation only
  router.post('/github/repos', wrap(async (req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    const { query } = (req.body ?? {}) as { query?: string };
    const installationId = resolveGithubInstallation(req, res);
    if (!installationId) {
      res.status(401).json({ error: 'No GitHub installation selected. Click Connect GitHub, or load installations and choose one first.' });
      return;
    }
    const repos = await listGithubReposForInstallation(installationId, query);
    res.json({ repos, authSource: 'installation' });
  }));

  // POST /github/connect - clone/pull a repo locally and switch active WORK_DIR (installation only)
  router.post('/github/connect', wrap(async (req, res) => {
    if (!requireAdminRouteAccess(req, res)) return;
    const { repoFullName } = (req.body ?? {}) as {
      repoFullName?: string;
    };
    const installationId = resolveGithubInstallation(req, res);
    if (!installationId) {
      res.status(401).json({ error: 'No GitHub installation selected. Click Connect GitHub, or load installations and choose one first.' });
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

  // Register invoke, webhook, event, retry, dead-letter, metrics, and ops routes
  const invokeRoutes = registerInvokeRoutes(router, loop);

  // GET /health - Health check
  router.get('/health', wrap((_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      persistence: invokeRoutes.eventPersistence.health(),
    });
  }));

  return router;
}
