import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import { buildRunIngressMeta } from './run-contract.js';
import { OPS } from './ops.js';
import { apiError, ErrorCodes } from './error-codes.js';
import { applyTimeWindow, recordInvokeEvent, wrap, type InvokeEvent, type InvokeRoutesDeps } from './invoke-shared.js';
import { auditLog } from './audit-log.js';
import { hmacAuth } from './hmac-auth.js';

let warnedUnprotectedInvoke = false;

export function authorizeInvoke(req: Request, res: Response): boolean {
  const invokeToken = process.env['SHIPYARD_INVOKE_TOKEN'];
  if (!invokeToken) {
    OPS.increment('shipyard.security.unprotected_invoke');
    if (!warnedUnprotectedInvoke) {
      warnedUnprotectedInvoke = true;
      console.warn('[WARN] invoke endpoint unprotected - set SHIPYARD_INVOKE_TOKEN');
    }
    return true;
  }
  const header = (req.headers['x-shipyard-invoke-token'] as string) ?? '';
  const bearer = ((req.headers['authorization'] as string) ?? '').replace(/^Bearer\s+/i, '');
  if (header === invokeToken || bearer === invokeToken) return true;
  res.status(401).json(apiError('Invalid or missing invoke token', ErrorCodes.AUTH_FAILED));
  return false;
}

export function maybeReplayIdempotent(req: Request, res: Response): boolean {
  const key = req.headers['x-idempotency-key'] as string;
  if (!key) return false;
  const bodyHash = OPS.bodyHash(JSON.stringify(req.body));
  const existing = OPS.getIdempotency(key);
  if (!existing) return false;
  if (existing.bodyHash !== bodyHash) {
    res.status(409).json(
      apiError('Idempotency key reused with different payload', ErrorCodes.IDEMPOTENT_REPLAY, { idempotencyKey: key }),
    );
    return true;
  }
  res.status(existing.status).set('X-Idempotency-Replayed', 'true').json(existing.payload);
  return true;
}

export function storeIdempotency(req: Request, status: number, payload: unknown): void {
  const key = req.headers['x-idempotency-key'] as string;
  if (!key) return;
  OPS.setIdempotency(key, {
    bodyHash: OPS.bodyHash(JSON.stringify(req.body)),
    status,
    payload,
    createdAt: Date.now(),
  });
}

export function registerInvokeHandlers(router: Router, deps: InvokeRoutesDeps): void {
  const { loop, eventIndex, eventPersistence, maxInvokeEvents } = deps;

  router.post(
    '/invoke',
    hmacAuth(),
    wrap((req, res) => {
      if (!authorizeInvoke(req, res)) return;
      if (maybeReplayIdempotent(req, res)) return;

      const { instruction, source, eventType, metadata } = req.body as {
        instruction?: string;
        source?: string;
        eventType?: string;
        metadata?: Record<string, unknown>;
      };
      if (!instruction || typeof instruction !== 'string') {
        OPS.increment('shipyard.invoke.rejected');
        res.status(400).json(apiError('instruction is required', ErrorCodes.MISSING_FIELD, { field: 'instruction' }));
        return;
      }
      if (instruction.length > 10_000) {
        OPS.increment('shipyard.invoke.rejected');
        res.status(400).json(
          apiError('instruction exceeds maximum length of 10000 characters', ErrorCodes.INVALID_FIELD, {
            field: 'instruction',
            maxLength: 10_000,
          }),
        );
        return;
      }

      const eventId = randomUUID();
      const correlationId = (req.headers['x-correlation-id'] as string) ?? eventId;
      const ingress = buildRunIngressMeta({
        source: 'invoke',
        entrypoint: '/api/invoke',
        instruction,
        runMode: 'auto',
        queueDepthAtIngress: loop.getStatus().queueLength,
        requestId: req.headers['x-request-id'] as string,
        idempotencyKey: req.headers['x-idempotency-key'] as string,
        correlationId,
        eventId,
      });
      const runId = loop.submit(instruction, undefined, false, 'auto');
      const event: InvokeEvent = {
        id: eventId,
        source: source ?? 'api',
        eventType: eventType ?? 'invoke',
        status: 'accepted',
        instruction,
        runId,
        metadata: metadata ?? {},
        receivedAt: new Date().toISOString(),
        retryAttempts: 0,
        ingress,
      };
      recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
      OPS.increment('shipyard.invoke.accepted');

      const payload = { eventId, runId, status: 'accepted', correlationId };
      storeIdempotency(req, 200, payload);
      auditLog({
        action: 'invoke',
        callerIp: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        callerScope: process.env['SHIPYARD_INVOKE_TOKEN'] ? 'invoke-token' : 'unprotected',
        eventCount: 1,
        resultSummary: 'accepted',
        meta: { eventId, correlationId },
      });
      res.json(payload);
    }),
  );

  router.post(
    '/invoke/batch',
    hmacAuth(),
    wrap((req, res) => {
      if (!authorizeInvoke(req, res)) return;
      const { items } = req.body as {
        items?: Array<{ instruction?: string; source?: string; eventType?: string; metadata?: Record<string, unknown> }>;
      };
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json(apiError('items array is required', ErrorCodes.MISSING_FIELD, { field: 'items' }));
        return;
      }
      if (items.length > 20) {
        res.status(400).json(
          apiError('Maximum 20 items per batch', ErrorCodes.BATCH_TOO_LARGE, { field: 'items', max: 20, actual: items.length }),
        );
        return;
      }

      const batchCorrelationId = req.headers['x-correlation-id'] as string | undefined;
      const results: Array<{ eventId: string; runId: string; status: string; correlationId?: string; error?: string; code?: string }> = [];

      for (const item of items) {
        if (!item.instruction || typeof item.instruction !== 'string') {
          results.push({
            eventId: '',
            runId: '',
            status: 'rejected',
            error: 'instruction is required',
            code: ErrorCodes.MISSING_FIELD,
          });
          continue;
        }

        const eventId = randomUUID();
        const runId = loop.submit(item.instruction, undefined, false, 'auto');
        const event: InvokeEvent = {
          id: eventId,
          source: item.source ?? 'api',
          eventType: item.eventType ?? 'invoke',
          status: 'accepted',
          instruction: item.instruction,
          runId,
          metadata: item.metadata ?? {},
          receivedAt: new Date().toISOString(),
          retryAttempts: 0,
          ingress: buildRunIngressMeta({
            source: 'batch',
            entrypoint: '/api/invoke/batch',
            instruction: item.instruction,
            runMode: 'auto',
            queueDepthAtIngress: loop.getStatus().queueLength,
            correlationId: batchCorrelationId ?? eventId,
            eventId,
          }),
        };
        recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
        OPS.increment('shipyard.invoke.accepted');
        results.push({ eventId, runId, status: 'accepted', correlationId: batchCorrelationId ?? eventId });
      }

      auditLog({
        action: 'invoke-batch',
        callerIp: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        callerScope: process.env['SHIPYARD_INVOKE_TOKEN'] ? 'invoke-token' : 'unprotected',
        eventCount: results.length,
        resultSummary: 'accepted',
      });
      res.json({ results, total: results.length });
    }),
  );

  router.get(
    '/invoke/events',
    wrap((req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query['limit'] as string, 10) || 50, 1), 500);
      const filters: Record<string, string> = {};
      if (req.query['source']) filters['source'] = String(req.query['source']);
      if (req.query['eventType']) filters['eventType'] = String(req.query['eventType']);
      if (req.query['status']) filters['status'] = String(req.query['status']);
      const from = req.query['from'] ? String(req.query['from']) : undefined;
      const to = req.query['to'] ? String(req.query['to']) : undefined;
      res.json(applyTimeWindow(eventIndex.query(filters), from, to).slice(0, limit));
    }),
  );

  router.get(
    '/invoke/events/summary',
    wrap((req, res) => {
      const filters: Record<string, string> = {};
      if (req.query['source']) filters['source'] = String(req.query['source']);
      if (req.query['eventType']) filters['eventType'] = String(req.query['eventType']);
      if (req.query['status']) filters['status'] = String(req.query['status']);

      let from = req.query['from'] ? String(req.query['from']) : undefined;
      const to = req.query['to'] ? String(req.query['to']) : undefined;
      const windowMs = req.query['windowMs'] ? parseInt(String(req.query['windowMs']), 10) : undefined;
      if (windowMs && Number.isFinite(windowMs) && windowMs > 0 && !from) {
        from = new Date(Date.now() - windowMs).toISOString();
      }

      const filtered = applyTimeWindow(eventIndex.query(filters), from, to);
      const bySource: Record<string, number> = {};
      const byEventType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      let totalRetryAttempts = 0;
      let oldestTs = Infinity;
      let newestTs = -Infinity;
      for (const ev of filtered) {
        bySource[ev.source] = (bySource[ev.source] ?? 0) + 1;
        byEventType[ev.eventType] = (byEventType[ev.eventType] ?? 0) + 1;
        byStatus[ev.status] = (byStatus[ev.status] ?? 0) + 1;
        totalRetryAttempts += ev.retryAttempts ?? 0;
        const ts = Date.parse(ev.receivedAt);
        if (Number.isFinite(ts)) {
          if (ts < oldestTs) oldestTs = ts;
          if (ts > newestTs) newestTs = ts;
        }
      }
      const result: Record<string, unknown> = {
        total: filtered.length,
        bySource,
        byEventType,
        byStatus,
        avgRetryAttempts: filtered.length > 0 ? Math.round((totalRetryAttempts / filtered.length) * 1000) / 1000 : 0,
        oldestEvent: Number.isFinite(oldestTs) ? new Date(oldestTs).toISOString() : null,
        newestEvent: Number.isFinite(newestTs) ? new Date(newestTs).toISOString() : null,
      };

      const groupBy = req.query['groupBy'] ? String(req.query['groupBy']) : undefined;
      if (groupBy && ['minute', 'hour', 'day'].includes(groupBy)) {
        const bucketMap = new Map<string, number>();
        for (const ev of filtered) {
          const d = new Date(ev.receivedAt);
          const key = groupBy === 'minute'
            ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
            : groupBy === 'hour'
              ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00`
              : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          bucketMap.set(key, (bucketMap.get(key) ?? 0) + 1);
        }
        result['timeSeries'] = Array.from(bucketMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([bucket, count]) => ({ bucket, count }));
      }
      res.json(result);
    }),
  );
}
