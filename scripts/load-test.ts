/**
 * Load test for webhook + retry-batch endpoints.
 * Measures: throughput, latency percentiles, queue saturation, error rates.
 * Usage: npx tsx scripts/load-test.ts [--concurrency 10] [--duration 30] [--target webhook|retry|both]
 *
 * No external load testing deps. Uses native fetch + async/await.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGithubWebhookSecret } from '../src/server/github-webhook.js';

/* ------------------------------------------------------------------ */
/*  CLI arg parsing                                                    */
/* ------------------------------------------------------------------ */

function argValue(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx < 0) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith('--') ? v : null;
}

const CONCURRENCY = Math.max(1, Number(argValue('concurrency') ?? 10));
const DURATION_S = Math.max(1, Number(argValue('duration') ?? 30));
const TARGET: 'webhook' | 'retry' | 'both' = (() => {
  const t = argValue('target') ?? 'both';
  if (t === 'webhook' || t === 'retry' || t === 'both') return t;
  return 'both';
})();
const BASE_URL = (argValue('base-url') ?? 'http://localhost:4200').replace(/\/$/, '');
const WEBHOOK_SECRET = resolveGithubWebhookSecret() ?? 'load-test-secret';
const API_KEY_TOKEN = process.env['SHIPYARD_API_KEY'] ?? '';
const INVOKE_TOKEN = process.env['SHIPYARD_INVOKE_TOKEN'] ?? '';
const RETRY_TOKEN = process.env['SHIPYARD_RETRY_TOKEN'] ?? '';
const ADMIN_TOKEN = process.env['SHIPYARD_ADMIN_TOKEN'] ?? '';
const READ_TOKEN = process.env['SHIPYARD_READ_TOKEN'] ?? '';

type AuthScope = 'invoke' | 'retry' | 'read';

export function resolveAuthToken(scope: AuthScope): string {
  if (scope === 'invoke') {
    return INVOKE_TOKEN || API_KEY_TOKEN || '';
  }
  if (scope === 'retry') {
    return RETRY_TOKEN || INVOKE_TOKEN || ADMIN_TOKEN || API_KEY_TOKEN || '';
  }
  return READ_TOKEN || ADMIN_TOKEN || API_KEY_TOKEN || '';
}

export function buildAuthHeaders(scope: AuthScope): Record<string, string> {
  const token = resolveAuthToken(scope).trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/* ------------------------------------------------------------------ */
/*  Payload generators                                                 */
/* ------------------------------------------------------------------ */

export function generateWebhookPayload(index: number): {
  body: string;
  signature: string;
  delivery: string;
} {
  const delivery = `load-test-${Date.now()}-${index}-${randomUUID().slice(0, 8)}`;
  const commentId = 10000 + index;
  const payload = JSON.stringify({
    action: 'created',
    comment: {
      id: commentId,
      body: `/shipyard run load test task ${index}`,
      html_url: `https://github.com/load/test/issues/1#issuecomment-${commentId}`,
    },
    repository: { full_name: 'load/test-repo' },
    issue: { number: 1 },
    installation: { id: 99999 },
    sender: { login: 'load-tester' },
  });
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  return { body: payload, signature, delivery };
}

export function generateRetryBatchPayload(eventIds: string[]): string {
  return JSON.stringify({ eventIds: eventIds.slice(0, 20) });
}

/* ------------------------------------------------------------------ */
/*  Latency + stats tracking                                           */
/* ------------------------------------------------------------------ */

export interface RequestRecord {
  startMs: number;
  endMs: number;
  latencyMs: number;
  status: number;
  ok: boolean;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export interface LoadTestSummary {
  target: string;
  concurrency: number;
  durationSeconds: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  status503Count: number;
  successRate: number;
  errorRate: number;
  saturation503Rate: number;
  latencyP50Ms: number;
  latencyP90Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  latencyMeanMs: number;
  throughputRps: number;
  statusCounts: Record<number, number>;
}

export function buildSummary(
  records: RequestRecord[],
  target: string,
  concurrency: number,
  durationSeconds: number,
): LoadTestSummary {
  const latencies = records.map((r) => r.latencyMs);
  const successCount = records.filter((r) => r.ok).length;
  const errorCount = records.filter((r) => !r.ok).length;
  const status503 = records.filter((r) => r.status === 503).length;
  const statusCounts: Record<number, number> = {};
  for (const r of records) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  const elapsed = records.length > 0
    ? (Math.max(...records.map((r) => r.endMs)) - Math.min(...records.map((r) => r.startMs))) / 1000
    : durationSeconds;

  return {
    target,
    concurrency,
    durationSeconds,
    totalRequests: records.length,
    successCount,
    errorCount,
    status503Count: status503,
    successRate: records.length ? successCount / records.length : 0,
    errorRate: records.length ? errorCount / records.length : 0,
    saturation503Rate: records.length ? status503 / records.length : 0,
    latencyP50Ms: percentile(latencies, 50),
    latencyP90Ms: percentile(latencies, 90),
    latencyP95Ms: percentile(latencies, 95),
    latencyP99Ms: percentile(latencies, 99),
    latencyMinMs: latencies.length ? Math.min(...latencies) : 0,
    latencyMaxMs: latencies.length ? Math.max(...latencies) : 0,
    latencyMeanMs: latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0,
    throughputRps: elapsed > 0 ? records.length / elapsed : 0,
    statusCounts,
  };
}

export function formatSummaryTable(summary: LoadTestSummary): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`=== Load Test Results: ${summary.target} ===`);
  lines.push('');
  lines.push(`  Concurrency:       ${summary.concurrency}`);
  lines.push(`  Duration:          ${summary.durationSeconds}s`);
  lines.push(`  Total requests:    ${summary.totalRequests}`);
  lines.push(`  Throughput:        ${summary.throughputRps.toFixed(2)} req/s`);
  lines.push('');
  lines.push('  --- Status Codes ---');
  for (const [code, count] of Object.entries(summary.statusCounts).sort()) {
    lines.push(`    ${code}: ${count}`);
  }
  lines.push('');
  lines.push('  --- Success / Error ---');
  lines.push(`    Success:         ${summary.successCount} (${(summary.successRate * 100).toFixed(1)}%)`);
  lines.push(`    Error:           ${summary.errorCount} (${(summary.errorRate * 100).toFixed(1)}%)`);
  lines.push(`    503 (queue full): ${summary.status503Count} (${(summary.saturation503Rate * 100).toFixed(1)}%)`);
  lines.push('');
  lines.push('  --- Latency Percentiles ---');
  lines.push(`    p50:  ${summary.latencyP50Ms.toFixed(1)}ms`);
  lines.push(`    p90:  ${summary.latencyP90Ms.toFixed(1)}ms`);
  lines.push(`    p95:  ${summary.latencyP95Ms.toFixed(1)}ms`);
  lines.push(`    p99:  ${summary.latencyP99Ms.toFixed(1)}ms`);
  lines.push(`    min:  ${summary.latencyMinMs.toFixed(1)}ms`);
  lines.push(`    max:  ${summary.latencyMaxMs.toFixed(1)}ms`);
  lines.push(`    mean: ${summary.latencyMeanMs.toFixed(1)}ms`);
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Request executors                                                  */
/* ------------------------------------------------------------------ */

async function fireWebhookRequest(index: number): Promise<RequestRecord> {
  const { body, signature, delivery } = generateWebhookPayload(index);
  const start = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${BASE_URL}/api/github/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'issue_comment',
        'x-github-delivery': delivery,
        'x-hub-signature-256': signature,
      },
      body,
    });
    status = res.status;
    // Drain body to free socket
    await res.text();
  } catch {
    status = 0;
  }
  const end = Date.now();
  return {
    startMs: start,
    endMs: end,
    latencyMs: end - start,
    status,
    ok: status >= 200 && status < 300,
  };
}

async function fireRetryBatchRequest(eventIds: string[], batchSize: number): Promise<RequestRecord> {
  const ids = eventIds.slice(0, Math.min(batchSize, 20));
  const body = generateRetryBatchPayload(ids);
  const start = Date.now();
  let status = 0;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders('retry'),
    };
    if (INVOKE_TOKEN.trim()) {
      headers['x-shipyard-invoke-token'] = INVOKE_TOKEN.trim();
    }
    const res = await fetch(`${BASE_URL}/api/invoke/events/retry-batch`, {
      method: 'POST',
      headers,
      body,
    });
    status = res.status;
    await res.text();
  } catch {
    status = 0;
  }
  const end = Date.now();
  return {
    startMs: start,
    endMs: end,
    latencyMs: end - start,
    status,
    ok: status >= 200 && status < 300,
  };
}

/* ------------------------------------------------------------------ */
/*  Load test runners                                                  */
/* ------------------------------------------------------------------ */

async function runWebhookLoadTest(): Promise<LoadTestSummary> {
  console.log(`[load-test] webhook: concurrency=${CONCURRENCY} duration=${DURATION_S}s`);
  const records: RequestRecord[] = [];
  const deadline = Date.now() + DURATION_S * 1000;
  let counter = 0;

  const worker = async () => {
    while (Date.now() < deadline) {
      const idx = counter++;
      const record = await fireWebhookRequest(idx);
      records.push(record);
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  return buildSummary(records, 'webhook', CONCURRENCY, DURATION_S);
}

async function seedWebhookEvents(count: number): Promise<string[]> {
  console.log(`[load-test] seeding ${count} webhook events for retry test...`);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const { body, signature, delivery } = generateWebhookPayload(i + 90000);
    try {
      const res = await fetch(`${BASE_URL}/api/github/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issue_comment',
          'x-github-delivery': delivery,
          'x-hub-signature-256': signature,
        },
        body,
      });
      if (res.ok) {
        const data = await res.json() as { runId?: string };
        if (data.runId) ids.push(data.runId);
      } else {
        await res.text();
      }
    } catch {
      // skip failed seeds
    }
  }

  // Fetch replayable event IDs
  try {
    const headers: Record<string, string> = {
      ...buildAuthHeaders('read'),
    };
    if (INVOKE_TOKEN.trim()) {
      headers['x-shipyard-invoke-token'] = INVOKE_TOKEN.trim();
    }
    const eventsRes = await fetch(
      `${BASE_URL}/api/invoke/events?limit=500&source=github&status=accepted&replayable=true`,
      { headers },
    );
    if (eventsRes.ok) {
      const body = await eventsRes.json() as unknown;
      const events = Array.isArray(body)
        ? body
        : ((body as { events?: unknown }).events ?? []);
      if (Array.isArray(events)) {
        return events
          .map((e) => (e as { id?: unknown }).id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
      return [];
    }
    const errorBody = await eventsRes.text();
    console.warn(`[load-test] unable to read replayable events: status=${eventsRes.status} body=${errorBody.slice(0, 200)}`);
  } catch {
    // fall through
  }

  return [];
}

async function runRetryBatchLoadTest(): Promise<LoadTestSummary> {
  const seedCount = Math.min(50, CONCURRENCY * 5);
  const eventIds = await seedWebhookEvents(seedCount);
  if (eventIds.length === 0) {
    console.log('[load-test] no replayable events found; retry-batch test skipped');
    return buildSummary([], 'retry-batch', CONCURRENCY, DURATION_S);
  }
  console.log(`[load-test] retry-batch: concurrency=${CONCURRENCY} duration=${DURATION_S}s events=${eventIds.length}`);

  const records: RequestRecord[] = [];
  const deadline = Date.now() + DURATION_S * 1000;
  const batchSizes = [1, 3, 5, 10, 15, 20];

  const worker = async (workerIdx: number) => {
    let iter = 0;
    while (Date.now() < deadline) {
      const batchSize = batchSizes[(workerIdx + iter) % batchSizes.length]!;
      const record = await fireRetryBatchRequest(eventIds, batchSize);
      records.push(record);
      iter++;
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  return buildSummary(records, 'retry-batch', CONCURRENCY, DURATION_S);
}

/* ------------------------------------------------------------------ */
/*  Health check                                                       */
/* ------------------------------------------------------------------ */

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not healthy at ${BASE_URL}/api/health`);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log(`[load-test] target=${TARGET} concurrency=${CONCURRENCY} duration=${DURATION_S}s base=${BASE_URL}`);

  await waitForHealth();

  const summaries: LoadTestSummary[] = [];

  if (TARGET === 'webhook' || TARGET === 'both') {
    const s = await runWebhookLoadTest();
    summaries.push(s);
    console.log(formatSummaryTable(s));
  }

  if (TARGET === 'retry' || TARGET === 'both') {
    const s = await runRetryBatchLoadTest();
    summaries.push(s);
    console.log(formatSummaryTable(s));
  }

  // Save results
  const outDir = join(process.cwd(), 'results');
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 15);
  const outPath = join(outDir, `load-test-${ts}.json`);

  const result = {
    type: 'load_test',
    version: 1,
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    target: TARGET,
    concurrency: CONCURRENCY,
    durationSeconds: DURATION_S,
    summaries,
  };

  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`[load-test] results saved to ${outPath}`);
}

main().catch((err) => {
  console.error('[load-test] fatal:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
