import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Router } from 'express';
import { OPS } from './ops.js';
import { buildRunIngressMeta } from './run-contract.js';
import { isBotSender } from './bot-guard.js';
import { evaluateWebhookPolicy } from './webhook-policy.js';
import { apiError, ErrorCodes } from './error-codes.js';
import { sanitizeHeaders } from './dead-letter.js';
import { recordInvokeEvent, wrap, type InvokeEvent, type InvokeRoutesDeps } from './invoke-shared.js';

export function verifyGithubWebhookSignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  const expected = Buffer.from(`sha256=${digest}`, 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractCommandFromComment(body: string): { instruction: string | null; prefixRequired: boolean; prefix: string } {
  const prefix = (process.env['SHIPYARD_COMMAND_PREFIX'] ?? '/shipyard').trim();
  const regex = new RegExp(`${escapeRegex(prefix)}\\s+(.+)`, 'i');
  const match = body.match(regex);
  if (match) {
    return { instruction: match[1]!.trim(), prefixRequired: true, prefix };
  }
  return { instruction: null, prefixRequired: true, prefix };
}

export function registerWebhookHandlers(router: Router, deps: InvokeRoutesDeps): void {
  const { loop, dedupeStore, deadLetterQueue, eventIndex, eventPersistence, maxInvokeEvents } = deps;

  router.post(
    '/github/webhook',
    wrap((req, res) => {
      const secret = process.env['GITHUB_WEBHOOK_SECRET'];
      if (secret) {
        const sig = req.headers['x-hub-signature-256'] as string | undefined;
        const raw = (req as { rawBody?: Buffer | string }).rawBody;
        const rawBody = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
        if (!rawBody || !verifyGithubWebhookSignature(rawBody, sig, secret)) {
          OPS.increment('shipyard.webhook.rejected');
          deadLetterQueue.add({
            reason: rawBody ? 'HMAC signature verification failed' : 'Missing raw body for signature verification',
            reasonCode: 'signature_invalid',
            webhookDeliveryId: (req.headers['x-github-delivery'] as string) ?? undefined,
            webhookEventType: (req.headers['x-github-event'] as string) ?? undefined,
            headers: sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>),
            replayable: false,
          });
          OPS.increment('shipyard.dead_letter.added');
          res.status(401).json(apiError('Invalid webhook signature', ErrorCodes.SIGNATURE_INVALID));
          return;
        }
      }

      const deliveryId = req.headers['x-github-delivery'] as string;
      const eventType = (req.headers['x-github-event'] as string) ?? 'unknown';
      if (deliveryId && dedupeStore.has(deliveryId)) {
        OPS.increment('shipyard.webhook.dedupe_hit');
        res.json({ status: 'duplicate', deliveryId });
        return;
      }

      const payload = req.body as Record<string, unknown>;
      const action = String(payload['action'] ?? '');
      const sender = payload['sender'] as Record<string, unknown> | undefined;
      if (sender) {
        const botCheck = isBotSender({ login: sender['login'] as string | undefined, type: sender['type'] as string | undefined });
        if (botCheck.isBot) {
          OPS.increment('shipyard.webhook.bot_skipped');
          res.json({ status: 'skipped', reason: botCheck.reason, code: ErrorCodes.BOT_SENDER_SKIPPED, deliveryId });
          return;
        }

        const comment = payload['comment'] as Record<string, unknown> | undefined;
        const policyResult = evaluateWebhookPolicy({
          login: sender['login'] as string | undefined,
          type: sender['type'] as string | undefined,
          association: (comment?.['author_association'] as string) ?? (payload['author_association'] as string | undefined),
        });
        if (!policyResult.allowed) {
          OPS.increment('shipyard.webhook.policy_denied');
          res.status(403).json(
            apiError(policyResult.reason ?? 'Sender not authorized', ErrorCodes.WEBHOOK_SENDER_DENIED, {
              sender: sender['login'],
              association: (comment?.['author_association'] as string) ?? (payload['author_association'] as string | undefined),
            }),
          );
          return;
        }
      }

      let instruction: string | null = null;
      if (eventType === 'issue_comment' && action === 'created' && typeof payload['comment'] === 'object' && payload['comment'] !== null) {
        const comment = payload['comment'] as Record<string, unknown>;
        const body = String(comment['body'] ?? '');
        instruction = extractCommandFromComment(body).instruction;
      }
      if (!instruction) {
        OPS.increment('shipyard.webhook.rejected');
        const prefix = (process.env['SHIPYARD_COMMAND_PREFIX'] ?? '/shipyard').trim();
        res.json({ status: 'ignored', reason: `No ${prefix} command found`, code: ErrorCodes.COMMAND_PREFIX_MISSING, deliveryId });
        return;
      }

      if (deliveryId) {
        dedupeStore.set(deliveryId, {
          eventId: randomUUID(),
          deliveryId,
          eventType,
          receivedAt: new Date().toISOString(),
          ttlMs: 86_400_000,
        });
      }

      const eventId = randomUUID();
      const runId = loop.submit(instruction, undefined, false, 'auto');
      const event: InvokeEvent = {
        id: eventId,
        source: 'github',
        eventType: `github.${eventType}`,
        status: 'accepted',
        instruction,
        runId,
        metadata: {
          deliveryId,
          action,
          sender: (payload['sender'] as Record<string, unknown>)?.['login'],
        },
        receivedAt: new Date().toISOString(),
        retryAttempts: 0,
        ingress: buildRunIngressMeta({
          source: 'webhook',
          entrypoint: '/api/github/webhook',
          instruction,
          runMode: 'auto',
          queueDepthAtIngress: loop.getStatus().queueLength,
          correlationId: (req.headers['x-correlation-id'] as string) ?? eventId,
          webhookDeliveryId: deliveryId,
          webhookEventType: eventType,
          eventId,
        }),
      };
      recordInvokeEvent(eventIndex, eventPersistence, maxInvokeEvents, event);
      OPS.increment('shipyard.webhook.accepted');
      res.json({ status: 'accepted', eventId, runId, deliveryId, correlationId: (req.headers['x-correlation-id'] as string) ?? eventId });
    }),
  );
}
