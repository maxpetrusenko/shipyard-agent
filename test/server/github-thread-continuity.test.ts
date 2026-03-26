import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { InstructionLoop } from '../../src/runtime/loop.js';

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createApp(new InstructionLoop());
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://localhost:${port}/api` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function signPayload(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

async function postWebhook(
  baseUrl: string,
  secret: string,
  eventType: 'issue_comment' | 'pull_request_review_comment',
  deliveryId: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const raw = JSON.stringify(payload);
  return fetch(`${baseUrl}/github/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': signPayload(secret, raw),
      'x-github-delivery': deliveryId,
      'x-github-event': eventType,
    },
    body: raw,
  });
}

afterEach(() => {
  delete process.env['SHIPYARD_GITHUB_WEBHOOK_SECRET'];
  delete process.env['GITHUB_WEBHOOK_SECRET'];
});

describe('GitHub thread continuity', () => {
  it('reuses the same run id for repeated issue comments in one issue thread', async () => {
    process.env['GITHUB_WEBHOOK_SECRET'] = 'issue-thread-secret';
    const { server, baseUrl } = await startServer();
    try {
      const runIds = new Set<string>();
      for (let i = 1; i <= 9; i++) {
        const res = await postWebhook(
          baseUrl,
          'issue-thread-secret',
          'issue_comment',
          `issue-delivery-${i}`,
          {
            action: 'created',
            sender: { login: 'octocat', type: 'User' },
            repository: { full_name: 'acme/widgets' },
            issue: { number: 42 },
            installation: { id: 77 },
            comment: {
              id: 1_000 + i,
              body: `/shipyard run load test task ${i}`,
              html_url: `https://github.com/acme/widgets/issues/42#issuecomment-${1_000 + i}`,
              author_association: 'OWNER',
            },
          },
        );
        expect(res.status).toBe(200);
        const body = await res.json() as { status: string; runId?: string };
        expect(body.status).toBe('accepted');
        expect(body.runId).toBeTruthy();
        runIds.add(body.runId!);
      }
      expect(runIds.size).toBe(1);
    } finally {
      await stopServer(server);
    }
  });

  it('reuses the same run id for review-comment replies in one review thread', async () => {
    process.env['GITHUB_WEBHOOK_SECRET'] = 'review-thread-secret';
    const { server, baseUrl } = await startServer();
    try {
      const first = await postWebhook(
        baseUrl,
        'review-thread-secret',
        'pull_request_review_comment',
        'review-delivery-1',
        {
          action: 'created',
          sender: { login: 'octocat', type: 'User' },
          repository: { full_name: 'acme/widgets' },
          pull_request: { number: 88 },
          installation: { id: 77 },
          comment: {
            id: 7_001,
            body: '/shipyard run inspect failing diff thread',
            html_url: 'https://github.com/acme/widgets/pull/88#discussion_r7001',
            author_association: 'MEMBER',
          },
        },
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { status: string; runId?: string };
      expect(firstBody.status).toBe('accepted');
      expect(firstBody.runId).toBeTruthy();

      const second = await postWebhook(
        baseUrl,
        'review-thread-secret',
        'pull_request_review_comment',
        'review-delivery-2',
        {
          action: 'created',
          sender: { login: 'octocat', type: 'User' },
          repository: { full_name: 'acme/widgets' },
          pull_request: { number: 88 },
          installation: { id: 77 },
          comment: {
            id: 7_002,
            in_reply_to_id: 7_001,
            body: '/shipyard run continue with comment reply context',
            html_url: 'https://github.com/acme/widgets/pull/88#discussion_r7001',
            author_association: 'MEMBER',
          },
        },
      );
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { status: string; runId?: string };
      expect(secondBody.status).toBe('accepted');
      expect(secondBody.runId).toBe(firstBody.runId);
    } finally {
      await stopServer(server);
    }
  });

  it('accepts webhook signatures when only SHIPYARD_GITHUB_WEBHOOK_SECRET is set', async () => {
    process.env['SHIPYARD_GITHUB_WEBHOOK_SECRET'] = 'shipyard-secret';
    const { server, baseUrl } = await startServer();
    try {
      const res = await postWebhook(
        baseUrl,
        'shipyard-secret',
        'issue_comment',
        'shipyard-secret-delivery',
        {
          action: 'created',
          sender: { login: 'octocat', type: 'User' },
          repository: { full_name: 'acme/widgets' },
          issue: { number: 9 },
          installation: { id: 77 },
          comment: {
            id: 9_001,
            body: '/shipyard ask confirm webhook alias',
            html_url: 'https://github.com/acme/widgets/issues/9#issuecomment-9001',
            author_association: 'OWNER',
          },
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('accepted');
    } finally {
      await stopServer(server);
    }
  });
});
