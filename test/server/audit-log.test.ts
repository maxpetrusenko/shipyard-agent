import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditLog, configureAuditLog, getAuditLogStats, resetAuditLog } from '../../src/server/audit-log.js';

function tmpAuditFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'shipyard-audit-')), 'audit.jsonl');
}

afterEach(() => {
  resetAuditLog();
});

describe('audit-log hardening', () => {
  it('rotates files when audit log exceeds 10MB', () => {
    const file = tmpAuditFile();
    configureAuditLog({ filePath: file, maxEntries: 1000 });
    auditLog({
      action: 'huge-entry',
      callerIp: '127.0.0.1',
      callerScope: 'admin',
      resultSummary: 'x'.repeat(11 * 1024 * 1024),
    });
    auditLog({
      action: 'post-rotate',
      callerIp: '127.0.0.1',
      callerScope: 'admin',
      resultSummary: 'ok',
    });

    expect(existsSync(`${file}.1`)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(10 * 1024 * 1024);
  });

  it('returns audit stats for metrics endpoint wiring', () => {
    configureAuditLog({ filePath: tmpAuditFile(), maxEntries: 1000 });
    auditLog({
      timestamp: '2026-01-01T00:00:00.000Z',
      action: 'first',
      callerIp: '127.0.0.1',
      callerScope: 'admin',
    });
    auditLog({
      timestamp: '2026-01-01T00:05:00.000Z',
      action: 'second',
      callerIp: '127.0.0.1',
      callerScope: 'admin',
    });
    const stats = getAuditLogStats();
    expect(stats.entries).toBe(2);
    expect(stats.oldestEntry).toBe('2026-01-01T00:00:00.000Z');
    expect(stats.newestEntry).toBe('2026-01-01T00:05:00.000Z');
    expect(stats.sizeBytes).toBeGreaterThan(0);
  });
});
