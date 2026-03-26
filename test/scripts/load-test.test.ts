/**
 * Unit tests for load-test script helpers.
 * Tests payload generation, percentile calculation, summary building,
 * and summary formatting. No server required; fetch is not called.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  generateWebhookPayload,
  generateRetryBatchPayload,
  percentile,
  buildSummary,
  formatSummaryTable,
} from '../../scripts/load-test.js';
import type { RequestRecord, LoadTestSummary } from '../../scripts/load-test.js';

/* ------------------------------------------------------------------ */
/*  generateWebhookPayload                                             */
/* ------------------------------------------------------------------ */

describe('generateWebhookPayload', () => {
  it('returns valid JSON body with required GitHub webhook fields', () => {
    const { body, signature, delivery } = generateWebhookPayload(0);
    const parsed = JSON.parse(body) as {
      action: string;
      comment: { id: number; body: string; html_url: string };
      repository: { full_name: string };
      issue: { number: number };
      sender: { login: string };
    };
    expect(parsed.action).toBe('created');
    expect(parsed.comment.body).toContain('/shipyard run');
    expect(parsed.comment.id).toBeGreaterThan(0);
    expect(parsed.comment.html_url).toContain('https://github.com');
    expect(parsed.repository.full_name).toBeTruthy();
    expect(parsed.issue.number).toBeGreaterThan(0);
    expect(parsed.sender.login).toBeTruthy();
    expect(delivery).toContain('load-test-');
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('generates unique deliveries across calls', () => {
    const a = generateWebhookPayload(1);
    const b = generateWebhookPayload(2);
    expect(a.delivery).not.toBe(b.delivery);
  });

  it('produces a valid HMAC-SHA256 signature matching the body', () => {
    const secret =
      process.env['SHIPYARD_GITHUB_WEBHOOK_SECRET'] ??
      process.env['GITHUB_WEBHOOK_SECRET'] ??
      'load-test-secret';
    const { body, signature } = generateWebhookPayload(42);
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(signature).toBe(expected);
  });
});

/* ------------------------------------------------------------------ */
/*  generateRetryBatchPayload                                          */
/* ------------------------------------------------------------------ */

describe('generateRetryBatchPayload', () => {
  it('returns JSON with eventIds array', () => {
    const result = generateRetryBatchPayload(['id-a', 'id-b']);
    const parsed = JSON.parse(result) as { eventIds: string[] };
    expect(parsed.eventIds).toEqual(['id-a', 'id-b']);
  });

  it('truncates to max 20 ids', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    const result = generateRetryBatchPayload(ids);
    const parsed = JSON.parse(result) as { eventIds: string[] };
    expect(parsed.eventIds).toHaveLength(20);
  });

  it('handles empty array', () => {
    const result = generateRetryBatchPayload([]);
    const parsed = JSON.parse(result) as { eventIds: string[] };
    expect(parsed.eventIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  percentile                                                         */
/* ------------------------------------------------------------------ */

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the single value for single-element array', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('computes p50 as median', () => {
    const values = [10, 20, 30, 40, 50];
    const p50 = percentile(values, 50);
    expect(p50).toBe(30);
  });

  it('computes p99 near the max', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const p99 = percentile(values, 99);
    expect(p99).toBe(99);
  });

  it('computes p90 correctly on a known dataset', () => {
    const values = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    // [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const p90 = percentile(values, 90);
    expect(p90).toBe(90);
  });

  it('does not mutate the original array', () => {
    const values = [5, 1, 3, 2, 4];
    const copy = [...values];
    percentile(values, 50);
    expect(values).toEqual(copy);
  });
});

/* ------------------------------------------------------------------ */
/*  buildSummary                                                       */
/* ------------------------------------------------------------------ */

function makeRecord(latencyMs: number, status: number): RequestRecord {
  const start = 1000;
  return {
    startMs: start,
    endMs: start + latencyMs,
    latencyMs,
    status,
    ok: status >= 200 && status < 300,
  };
}

describe('buildSummary', () => {
  it('returns zero-state for empty records', () => {
    const s = buildSummary([], 'webhook', 5, 10);
    expect(s.totalRequests).toBe(0);
    expect(s.successCount).toBe(0);
    expect(s.errorCount).toBe(0);
    expect(s.status503Count).toBe(0);
    expect(s.successRate).toBe(0);
    expect(s.throughputRps).toBe(0);
    expect(s.latencyP50Ms).toBe(0);
  });

  it('computes correct counts and rates', () => {
    const records: RequestRecord[] = [
      makeRecord(10, 200),
      makeRecord(20, 200),
      makeRecord(30, 503),
      makeRecord(40, 500),
    ];
    const s = buildSummary(records, 'test', 2, 5);
    expect(s.totalRequests).toBe(4);
    expect(s.successCount).toBe(2);
    expect(s.errorCount).toBe(2);
    expect(s.status503Count).toBe(1);
    expect(s.successRate).toBeCloseTo(0.5);
    expect(s.errorRate).toBeCloseTo(0.5);
    expect(s.saturation503Rate).toBeCloseTo(0.25);
  });

  it('computes latency percentiles from records', () => {
    const records: RequestRecord[] = Array.from({ length: 100 }, (_, i) =>
      makeRecord(i + 1, 200),
    );
    const s = buildSummary(records, 'test', 1, 10);
    expect(s.latencyP50Ms).toBe(50);
    expect(s.latencyP90Ms).toBe(90);
    expect(s.latencyP95Ms).toBe(95);
    expect(s.latencyP99Ms).toBe(99);
    expect(s.latencyMinMs).toBe(1);
    expect(s.latencyMaxMs).toBe(100);
    expect(s.latencyMeanMs).toBeCloseTo(50.5);
  });

  it('groups status codes in statusCounts', () => {
    const records: RequestRecord[] = [
      makeRecord(5, 200),
      makeRecord(5, 200),
      makeRecord(5, 503),
      makeRecord(5, 429),
      makeRecord(5, 429),
      makeRecord(5, 429),
    ];
    const s = buildSummary(records, 'test', 1, 5);
    expect(s.statusCounts[200]).toBe(2);
    expect(s.statusCounts[503]).toBe(1);
    expect(s.statusCounts[429]).toBe(3);
  });

  it('calculates throughput from timing spread', () => {
    // 10 records, first starts at 1000ms, last ends at 2000ms => 1s => 10 rps
    const records: RequestRecord[] = Array.from({ length: 10 }, (_, i) => ({
      startMs: 1000 + i * 100,
      endMs: 1050 + i * 100,
      latencyMs: 50,
      status: 200,
      ok: true,
    }));
    const s = buildSummary(records, 'test', 1, 5);
    // Elapsed = (last endMs - first startMs) / 1000 = (1950 - 1000) / 1000 = 0.95s
    // Throughput = 10 / 0.95 = ~10.53
    expect(s.throughputRps).toBeGreaterThan(10);
    expect(s.throughputRps).toBeLessThan(12);
  });
});

/* ------------------------------------------------------------------ */
/*  formatSummaryTable                                                 */
/* ------------------------------------------------------------------ */

describe('formatSummaryTable', () => {
  it('returns a multi-line string with key metrics', () => {
    const summary: LoadTestSummary = {
      target: 'webhook',
      concurrency: 5,
      durationSeconds: 10,
      totalRequests: 100,
      successCount: 90,
      errorCount: 10,
      status503Count: 5,
      successRate: 0.9,
      errorRate: 0.1,
      saturation503Rate: 0.05,
      latencyP50Ms: 15,
      latencyP90Ms: 45,
      latencyP95Ms: 60,
      latencyP99Ms: 90,
      latencyMinMs: 2,
      latencyMaxMs: 120,
      latencyMeanMs: 25,
      throughputRps: 10,
      statusCounts: { 200: 90, 503: 5, 500: 5 },
    };

    const output = formatSummaryTable(summary);
    expect(output).toContain('Load Test Results: webhook');
    expect(output).toContain('Concurrency:       5');
    expect(output).toContain('Duration:          10s');
    expect(output).toContain('Total requests:    100');
    expect(output).toContain('10.00 req/s');
    expect(output).toContain('200: 90');
    expect(output).toContain('503: 5');
    expect(output).toContain('500: 5');
    expect(output).toContain('Success:         90 (90.0%)');
    expect(output).toContain('Error:           10 (10.0%)');
    expect(output).toContain('503 (queue full): 5 (5.0%)');
    expect(output).toContain('p50:  15.0ms');
    expect(output).toContain('p90:  45.0ms');
    expect(output).toContain('p95:  60.0ms');
    expect(output).toContain('p99:  90.0ms');
    expect(output).toContain('min:  2.0ms');
    expect(output).toContain('max:  120.0ms');
    expect(output).toContain('mean: 25.0ms');
  });

  it('handles zero-state summary without crashing', () => {
    const summary: LoadTestSummary = {
      target: 'retry-batch',
      concurrency: 1,
      durationSeconds: 1,
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      status503Count: 0,
      successRate: 0,
      errorRate: 0,
      saturation503Rate: 0,
      latencyP50Ms: 0,
      latencyP90Ms: 0,
      latencyP95Ms: 0,
      latencyP99Ms: 0,
      latencyMinMs: 0,
      latencyMaxMs: 0,
      latencyMeanMs: 0,
      throughputRps: 0,
      statusCounts: {},
    };

    const output = formatSummaryTable(summary);
    expect(output).toContain('Load Test Results: retry-batch');
    expect(output).toContain('Total requests:    0');
    expect(output).toContain('0.00 req/s');
  });
});
