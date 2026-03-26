import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { OPS } from './ops.js';
import { apiError, ErrorCodes, type ErrorCode } from './error-codes.js';
import { buildRunIngressMeta } from './run-contract.js';
import { authorizeInvoke, maybeReplayIdempotent, storeIdempotency } from './invoke-handler.js';
import { recordInvokeEvent, wrap, type InvokeEvent, type InvokeRoutesDeps } from './invoke-shared.js';
import { auditLog } from './audit-log.js';
import { hmacAuth } from './hmac-auth.js';

interface RetryLimitResult { allowed: boolean; reason?: string; code?: string; details?: Record<string, unknown> }
type RetryOrdering = 'newest_first' | 'oldest_first' | 'input_order';
type RetryBatchResult = { originalEventId: string; eventId: string; runId: string; status: string; error?: string; code?: string };

function applyRetryOrdering(eventIds: string[], ordering: RetryOrdering, deps: InvokeRoutesDeps): string[] {
  if (ordering === 'input_order') return eventIds;
  const withTimestamps = eventIds.map((id) => ({ id, receivedAt: deps.eventIndex.get(id)?.receivedAt ?? '' }));
  withTimestamps.sort((a, b) => (ordering === 'oldest_first' ? 1 : -1) * a.receivedAt.localeCompare(b.receivedAt));
  return withTimestamps.map((e) => e.id);
}

export function checkRetryLimits(event: InvokeEvent): RetryLimitResult {
  const parsedMax = parseInt(process.env['SHIPYARD_MAX_RETRIES'] ?? '5', 10);
  const maxRetries = Number.isFinite(parsedMax) ? parsedMax : 5;
  const parsedCooldown = parseInt(process.env['SHIPYARD_RETRY_COOLDOWN_MS'] ?? '60000', 10);
  const cooldownMs = Number.isFinite(parsedCooldown) ? parsedCooldown : 60000;
  if ((event.retryAttempts ?? 0) >= maxRetries) {
    return { allowed: false, reason: 'Retry cap exceeded', code: ErrorCodes.RATE_LIMITED, details: { maxRetries, attempts: event.retryAttempts ?? 0 } };
  }
  const lastRetried = (event.metadata as Record<string, unknown>)?.['lastRetriedAt'] as string | undefined;
  if (lastRetried) {
    const elapsed = Date.now() - Date.parse(lastRetried);
    if (elapsed < cooldownMs) {
      return { allowed: false, reason: 'Retry cooldown active', code: ErrorCodes.RATE_LIMITED, details: { cooldownMs, retryAfterMs: cooldownMs - elapsed } };
    }
  }
  return { allowed: true };
}

function makeRetryChildEvent(
  original: InvokeEvent,
  eventId: string,
  runId: string,
  correlationId: string,
  queueDepthAtIngress: number,
  entrypoint: string,
  source: 'retry' | 'retry-batch',
): InvokeEvent {
  original.metadata = { ...original.metadata, lastRetriedAt: new Date().toISOString() };
  const childMeta = { ...original.metadata, retryOf: original.id };
  delete (childMeta as Record<string, unknown>)['lastRetriedAt'];
  return {
    id: eventId,
    source: original.source,
    eventType: original.eventType,
    status: 'accepted',
    instruction: original.instruction,
    runId,
    metadata: childMeta,
    receivedAt: new Date().toISOString(),
    retryAttempts: (original.retryAttempts ?? 0) + 1,
    retryOfEventId: original.id,
    ingress: buildRunIngressMeta({
      source,
      entrypoint,
      instruction: original.instruction,
      runMode: 'auto',
      queueDepthAtIngress,
      correlationId,
      retryOfEventId: original.id,
      retryAttempt: (original.retryAttempts ?? 0) + 1,
      eventId,
    }),
  };
}

function pushRateLimitedResult(results: RetryBatchResult[], originalEventId: string, limitCheck: RetryLimitResult): void {
  results.push({ originalEventId, eventId: '', runId: '', status: 'rate_limited', error: limitCheck.reason, code: limitCheck.code });
}

export function registerRetryHandlers(router: Router, deps: InvokeRoutesDeps): void {
  const { loop, eventIndex, eventPersistence, maxInvokeEvents } = deps;

  router.post('/invoke/events/:id/retry', hmacAuth(), wrap((req, res) => {
    if (!authorizeInvoke(req, res)) return;
    if (maybeReplayIdempotent(req, res)) return;
    const original = eventIndex.get(req.params['id'] as string);
    if (!original) { res.status(404).json(apiError('Event not found', ErrorCodes.NOT_FOUND, { eventId: req.params['id'] })); return; }
    const limitCheck = checkRetryLimits(original);
    if (!limitCheck.allowed) { res.status(429).json(apiError(limitCheck.reason!, limitCheck.code! as ErrorCode, limitCheck.details)); return; }
    const eventId = randomUUID();
    const runId = loop.submit(original.instruction, undefined, false, 'auto');
    const event = makeRetryChildEvent(
      original,
      eventId,
      runId,
      (req.headers['x-correlation-id'] as string) ?? eventId,
      loop.getStatus().queueLength,
      '/api/invoke/events/:id/retry',
      'retry',
    );
    recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
    OPS.increment('shipyard.events.retried');
    const payload = { eventId, runId, retryOf: original.id, status: 'accepted' };
    storeIdempotency(req, 200, payload);
    auditLog({
      action: 'retry-single',
      callerIp: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      callerScope: 'invoke-token',
      eventCount: 1,
      resultSummary: 'accepted',
      meta: { retryOf: original.id, eventId },
    });
    res.json(payload);
  }));

  router.post('/invoke/events/retry-batch', hmacAuth(), wrap((req, res) => {
    if (!authorizeInvoke(req, res)) return;
    if (maybeReplayIdempotent(req, res)) return;
    const { eventIds, dryRun, maxAccepted, abortOnQueueFull, ordering } = req.body as {
      eventIds?: string[]; dryRun?: boolean; maxAccepted?: number; abortOnQueueFull?: boolean; ordering?: RetryOrdering;
    };
    if (!Array.isArray(eventIds) || eventIds.length === 0) { res.status(400).json(apiError('eventIds array is required', ErrorCodes.MISSING_FIELD, { field: 'eventIds' })); return; }
    if (eventIds.length > 20) { res.status(400).json(apiError('Maximum 20 retries per batch', ErrorCodes.BATCH_TOO_LARGE, { field: 'eventIds', max: 20, actual: eventIds.length })); return; }
    const validOrderings: RetryOrdering[] = ['newest_first', 'oldest_first', 'input_order'];
    const resolvedOrdering = ordering ?? 'input_order';
    if (!validOrderings.includes(resolvedOrdering)) {
      res.status(400).json(apiError(`Invalid ordering: "${ordering}". Must be one of: ${validOrderings.join(', ')}`, ErrorCodes.INVALID_FIELD, { field: 'ordering', allowed: validOrderings }));
      return;
    }

    const orderedIds = applyRetryOrdering(eventIds, resolvedOrdering, deps);
    const cap = maxAccepted ?? orderedIds.length;
    const results: RetryBatchResult[] = [];
    let accepted = 0; let rejected = 0; let skipped = 0;
    let stopReason: 'completed' | 'aborted_queue_full' | 'aborted_max_reached' = 'completed';

    for (const eid of orderedIds) {
      const original = eventIndex.get(eid);
      if (!original) { results.push({ originalEventId: eid, eventId: '', runId: '', status: 'not_found', error: 'Event not found', code: ErrorCodes.NOT_FOUND }); rejected++; continue; }
      if (accepted >= cap) { results.push({ originalEventId: eid, eventId: '', runId: '', status: 'skipped', error: 'maxAccepted reached' }); skipped++; stopReason = 'aborted_max_reached'; continue; }
      if (abortOnQueueFull && loop.getStatus().queueLength > 50) {
        results.push({ originalEventId: eid, eventId: '', runId: '', status: 'skipped', error: 'Queue full', code: ErrorCodes.QUEUE_FULL });
        skipped++; stopReason = 'aborted_queue_full'; break;
      }

      const limitCheck = checkRetryLimits(original);
      if (!limitCheck.allowed) { pushRateLimitedResult(results, eid, limitCheck); rejected++; continue; }
      if (dryRun) { results.push({ originalEventId: eid, eventId: 'dry-run', runId: 'dry-run', status: 'would_accept' }); accepted++; continue; }

      const eventId = randomUUID();
      const runId = loop.submit(original.instruction, undefined, false, 'auto');
      const event = makeRetryChildEvent(
        original,
        eventId,
        runId,
        (req.headers['x-correlation-id'] as string) ?? eventId,
        loop.getStatus().queueLength,
        '/api/invoke/events/retry-batch',
        'retry-batch',
      );
      recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
      OPS.increment('shipyard.events.retried');
      results.push({ originalEventId: eid, eventId, runId, status: 'accepted' });
      accepted++;
    }

    const payload = { results, total: results.length, accepted, summary: { total: results.length, accepted, rejected, skipped }, stopReason, ordering: resolvedOrdering };
    storeIdempotency(req, 200, payload);
    auditLog({
      action: 'retry-batch',
      callerIp: req.ip ?? req.socket.remoteAddress ?? 'unknown',
      callerScope: 'invoke-token',
      eventCount: results.length,
      dryRun: Boolean(dryRun),
      resultSummary: stopReason,
      meta: { accepted, rejected, skipped },
    });
    res.json(payload);
  }));

  router.post('/invoke/events/retry-strategy', hmacAuth(), wrap((req, res) => {
    if (!authorizeInvoke(req, res)) return;
    const { strategy, minutesBack, dryRun } = req.body as { strategy?: string; minutesBack?: number; dryRun?: boolean };
    if (strategy !== 'queue_full_recent') {
      res.status(400).json(apiError('Unsupported strategy. Allowed: queue_full_recent', ErrorCodes.INVALID_FIELD, { field: 'strategy', allowed: ['queue_full_recent'] }));
      return;
    }
    const cutoff = new Date(Date.now() - (minutesBack ?? 30) * 60_000).toISOString();
    const queuePattern = /queue|full/i;
    const matched = eventIndex.query({ status: 'rejected' }).filter((ev) => {
      if (ev.receivedAt < cutoff) return false;
      const errMsg = String((ev.metadata as Record<string, unknown>)?.['error'] ?? '');
      const statusMsg = String((ev.metadata as Record<string, unknown>)?.['reason'] ?? '');
      return queuePattern.test(errMsg) || queuePattern.test(statusMsg) || queuePattern.test(ev.instruction);
    });
    const retried: InvokeEvent[] = [];
    const isDryRun = dryRun !== false;
    if (!isDryRun) {
      for (const original of matched) {
        const limitCheck = checkRetryLimits(original);
        if (!limitCheck.allowed) continue;
        const eventId = randomUUID();
        const runId = loop.submit(original.instruction, undefined, false, 'auto');
        const event = makeRetryChildEvent(
          original, eventId, runId, eventId, loop.getStatus().queueLength, '/api/invoke/events/retry-strategy', 'retry-batch',
        );
        recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
        OPS.increment('shipyard.events.retried');
        retried.push(event);
      }
    }
    OPS.increment('shipyard.events.retry_strategy');
    res.json({ matched: matched.length, retried, dryRun: isDryRun });
  }));

  router.get('/invoke/events/retry-preview', wrap((req, res) => {
    const ids = ((req.query['eventIds'] as string) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { res.status(400).json(apiError('eventIds query param is required', ErrorCodes.MISSING_FIELD, { field: 'eventIds' })); return; }
    const events: Array<{ id: string; instruction: string; retryAttempts: number; wouldRetry: boolean; reason: string | null }> = [];
    let retryable = 0; let blocked = 0;
    for (const id of ids) {
      const ev = eventIndex.get(id);
      if (!ev) { events.push({ id, instruction: '', retryAttempts: 0, wouldRetry: false, reason: 'Event not found' }); blocked++; continue; }
      const limitCheck = checkRetryLimits(ev);
      if (limitCheck.allowed) { events.push({ id: ev.id, instruction: ev.instruction, retryAttempts: ev.retryAttempts, wouldRetry: true, reason: null }); retryable++; continue; }
      events.push({ id: ev.id, instruction: ev.instruction, retryAttempts: ev.retryAttempts, wouldRetry: false, reason: limitCheck.reason ?? null });
      blocked++;
    }
    res.json({ events, retryable, blocked });
  }));
}
