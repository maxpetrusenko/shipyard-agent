import type { Router } from 'express';
import { OPS } from './ops.js';
import { apiError, ErrorCodes } from './error-codes.js';
import { authorizeInvoke } from './invoke-handler.js';
import { computeErrorBudget } from './error-budget.js';
import { buildRecoveryReport } from './recovery-report.js';
import { checkProviderReadiness } from './provider-readiness.js';
import { getPackageVersion, wrap, type InvokeRoutesDeps } from './invoke-shared.js';
import { getAuditLogStats } from './audit-log.js';

let ackTemplate = process.env['SHIPYARD_ACK_TEMPLATE'] || 'Acknowledged {{repo}}#{{issue}} — runId={{runId}}, status={{status}}';

export function registerOperationalHandlers(router: Router, deps: InvokeRoutesDeps): void {
  const { eventIndex, dedupeStore, deadLetterQueue, memoryGuard } = deps;

  router.get(
    '/dead-letter',
    wrap((req, res) => {
      const limit = parseInt(req.query['limit'] as string, 10) || undefined;
      res.json(deadLetterQueue.list(limit));
    }),
  );

  router.get(
    '/dead-letter/:id',
    wrap((req, res) => {
      const entry = deadLetterQueue.get(req.params['id'] as string);
      if (!entry) {
        res.status(404).json(apiError('Dead-letter entry not found', ErrorCodes.NOT_FOUND, { id: req.params['id'] }));
        return;
      }
      res.json(entry);
    }),
  );

  router.post(
    '/dead-letter/:id/replay',
    wrap((req, res) => {
      if (!authorizeInvoke(req, res)) return;
      const entry = deadLetterQueue.get(req.params['id'] as string);
      if (!entry) {
        res.status(404).json(apiError('Dead-letter entry not found', ErrorCodes.NOT_FOUND, { id: req.params['id'] }));
        return;
      }
      if (!entry.replayable) {
        res.status(400).json(apiError('Entry is not replayable', ErrorCodes.NOT_REPLAYABLE, { reasonCode: entry.reasonCode }));
        return;
      }
      deadLetterQueue.remove(entry.id);
      res.json({ status: 'replayed', entryId: entry.id });
    }),
  );

  router.delete(
    '/dead-letter',
    wrap((_req, res) => {
      const count = deadLetterQueue.size();
      deadLetterQueue.clear();
      res.json({ cleared: count });
    }),
  );

  router.get('/providers/readiness', wrap(async (_req, res) => {
    res.json(await checkProviderReadiness());
  }));
  router.get('/memory', wrap((_req, res) => {
    res.json(memoryGuard.check());
  }));
  router.get('/healthz', wrap((_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  }));
  router.get('/readyz', wrap((_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  }));

  router.get(
    '/metrics',
    wrap((_req, res) => {
      const counters = OPS.snapshot();
      const gauges = memoryGuard.gauges();
      const timings = OPS.timingsSnapshot();
      res.json({ counters, gauges, timings, audit: getAuditLogStats(), timestamp: new Date().toISOString() });
    }),
  );

  router.get('/version', wrap((_req, res) => {
    res.json({ version: getPackageVersion() });
  }));

  router.get(
    '/invoke/events/error-budget',
    wrap((req, res) => {
      const windowMs = parseInt(req.query['windowMs'] as string, 10) || undefined;
      res.json(computeErrorBudget(eventIndex.all().map((ev) => ({
        status: ev.status,
        receivedAt: ev.receivedAt,
        metadata: ev.metadata,
      })), windowMs));
    }),
  );

  router.get(
    '/recovery/report',
    wrap((_req, res) => {
      res.json(
        buildRecoveryReport({
          events: eventIndex.all().map((ev) => ({ id: ev.id, source: ev.source, status: ev.status, receivedAt: ev.receivedAt })),
          dedupeKeyCount: dedupeStore.size,
          durationMs: 0,
        }),
      );
    }),
  );

  router.get('/settings/ack-template', wrap((_req, res) => {
    res.json({ template: ackTemplate });
  }));
  router.post(
    '/settings/ack-template',
    wrap((req, res) => {
      if ((req.headers['x-requested-with'] as string | undefined) !== 'XMLHttpRequest') {
        res.status(403).json({ error: 'Forbidden: missing X-Requested-With: XMLHttpRequest' });
        return;
      }
      const { template } = (req.body ?? {}) as { template?: string };
      if (typeof template !== 'string') {
        res.status(400).json({ error: 'template must be a string' });
        return;
      }
      ackTemplate = template;
      res.json({ ok: true });
    }),
  );
}
