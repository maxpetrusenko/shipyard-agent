/**
 * Tests for the unified RunIngressMeta contract and its factory function.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRunIngressMeta,
  CURRENT_SCHEMA_VERSION,
  migrateSchema,
  validateSchema,
  type RunIngressMeta,
  type IngressSource,
  type BuildRunIngressMetaParams,
} from '../../src/server/run-contract.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseParams(overrides: Partial<BuildRunIngressMetaParams> = {}): BuildRunIngressMetaParams {
  return {
    source: 'api',
    entrypoint: '/api/run',
    instruction: 'fix the bug',
    runMode: 'auto',
    queueDepthAtIngress: 0,
    ...overrides,
  };
}

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Core contract
// ---------------------------------------------------------------------------

describe('buildRunIngressMeta', () => {
  it('produces all required fields', () => {
    const meta = buildRunIngressMeta(baseParams());

    expect(meta.eventId).toMatch(UUID_RE);
    expect(meta.source).toBe('api');
    expect(meta.entrypoint).toBe('/api/run');
    expect(meta.timestamp).toMatch(ISO_8601_RE);
    expect(meta.instruction).toBe('fix the bug');
    expect(meta.runMode).toBe('auto');
    expect(meta.queueDepthAtIngress).toBe(0);
    expect(meta.schemaVersion).toBe(1);
  });

  it('schemaVersion is always 1', () => {
    const meta = buildRunIngressMeta(baseParams());
    expect(meta.schemaVersion).toBe(1);
  });

  it('timestamp defaults to valid ISO 8601', () => {
    const meta = buildRunIngressMeta(baseParams());
    expect(meta.timestamp).toMatch(ISO_8601_RE);
    // Should be parseable
    const d = new Date(meta.timestamp);
    expect(d.getTime()).toBeGreaterThan(0);
  });

  it('accepts an explicit eventId', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const meta = buildRunIngressMeta(baseParams({ eventId: id }));
    expect(meta.eventId).toBe(id);
  });

  it('accepts an explicit timestamp', () => {
    const ts = '2025-06-01T12:00:00.000Z';
    const meta = buildRunIngressMeta(baseParams({ timestamp: ts }));
    expect(meta.timestamp).toBe(ts);
  });

  it('generates unique eventIds across calls', () => {
    const a = buildRunIngressMeta(baseParams());
    const b = buildRunIngressMeta(baseParams());
    expect(a.eventId).not.toBe(b.eventId);
  });

  it('queueDepthAtIngress propagates numeric value', () => {
    const meta = buildRunIngressMeta(baseParams({ queueDepthAtIngress: 42 }));
    expect(meta.queueDepthAtIngress).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Optional fields
// ---------------------------------------------------------------------------

describe('optional fields', () => {
  it('omits optional fields when not provided', () => {
    const meta = buildRunIngressMeta(baseParams());
    expect(meta.requestId).toBeUndefined();
    expect(meta.idempotencyKey).toBeUndefined();
    expect(meta.correlationId).toBeUndefined();
    expect(meta.retryOfEventId).toBeUndefined();
    expect(meta.retryAttempt).toBeUndefined();
    expect(meta.webhookDeliveryId).toBeUndefined();
    expect(meta.webhookEventType).toBeUndefined();
    expect(meta.callerIdentity).toBeUndefined();
  });

  it('includes requestId when provided', () => {
    const meta = buildRunIngressMeta(baseParams({ requestId: 'req-123' }));
    expect(meta.requestId).toBe('req-123');
  });

  it('includes idempotencyKey when provided', () => {
    const meta = buildRunIngressMeta(baseParams({ idempotencyKey: 'idem-abc' }));
    expect(meta.idempotencyKey).toBe('idem-abc');
  });

  it('includes correlationId when provided', () => {
    const meta = buildRunIngressMeta(baseParams({ correlationId: 'corr-xyz' }));
    expect(meta.correlationId).toBe('corr-xyz');
  });
});

// ---------------------------------------------------------------------------
// Source-specific fields
// ---------------------------------------------------------------------------

describe('source-specific fields', () => {
  it('webhook source includes delivery and event type', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'webhook',
      entrypoint: '/github/webhook',
      webhookDeliveryId: 'gh-delivery-123',
      webhookEventType: 'issue_comment',
    }));
    expect(meta.source).toBe('webhook');
    expect(meta.webhookDeliveryId).toBe('gh-delivery-123');
    expect(meta.webhookEventType).toBe('issue_comment');
  });

  it('non-webhook source does not include webhook fields', () => {
    const meta = buildRunIngressMeta(baseParams({ source: 'api' }));
    expect(meta.webhookDeliveryId).toBeUndefined();
    expect(meta.webhookEventType).toBeUndefined();
  });

  it('retry source includes retryOfEventId and retryAttempt', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'retry',
      entrypoint: '/api/invoke/events/abc/retry',
      retryOfEventId: 'original-event-id',
      retryAttempt: 3,
    }));
    expect(meta.source).toBe('retry');
    expect(meta.retryOfEventId).toBe('original-event-id');
    expect(meta.retryAttempt).toBe(3);
  });

  it('retry-batch source works', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'retry-batch',
      entrypoint: '/api/invoke/events/retry-batch',
      retryOfEventId: 'batch-original',
      retryAttempt: 1,
    }));
    expect(meta.source).toBe('retry-batch');
    expect(meta.retryOfEventId).toBe('batch-original');
  });

  it('batch source works', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'batch',
      entrypoint: '/api/invoke/batch',
    }));
    expect(meta.source).toBe('batch');
  });

  it('invoke source works', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'invoke',
      entrypoint: '/api/invoke',
    }));
    expect(meta.source).toBe('invoke');
  });
});

// ---------------------------------------------------------------------------
// Caller identity
// ---------------------------------------------------------------------------

describe('callerIdentity', () => {
  it('records webhook sender', () => {
    const meta = buildRunIngressMeta(baseParams({
      source: 'webhook',
      callerIdentity: 'github:octocat',
    }));
    expect(meta.callerIdentity).toBe('github:octocat');
  });

  it('records API caller', () => {
    const meta = buildRunIngressMeta(baseParams({
      callerIdentity: 'user:max',
    }));
    expect(meta.callerIdentity).toBe('user:max');
  });
});

// ---------------------------------------------------------------------------
// All sources accepted
// ---------------------------------------------------------------------------

describe('all IngressSource variants', () => {
  const sources: IngressSource[] = ['api', 'invoke', 'webhook', 'retry', 'retry-batch', 'batch'];

  for (const src of sources) {
    it(`accepts source="${src}"`, () => {
      const meta = buildRunIngressMeta(baseParams({ source: src }));
      expect(meta.source).toBe(src);
      expect(meta.schemaVersion).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// CURRENT_SCHEMA_VERSION
// ---------------------------------------------------------------------------

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is exported and equals 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });

  it('matches schemaVersion from buildRunIngressMeta', () => {
    const meta = buildRunIngressMeta(baseParams());
    expect(meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// validateSchema
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
  /** Helper: a valid v1 meta object (plain object, not typed). */
  function validRawMeta(): Record<string, unknown> {
    return {
      eventId: '11111111-2222-3333-4444-555555555555',
      source: 'api',
      entrypoint: '/api/run',
      timestamp: '2025-06-01T12:00:00.000Z',
      instruction: 'fix the bug',
      runMode: 'auto',
      queueDepthAtIngress: 0,
      schemaVersion: 1,
    };
  }

  it('returns valid for a correct v1 meta', () => {
    const result = validateSchema(validRawMeta());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for output of buildRunIngressMeta', () => {
    const meta = buildRunIngressMeta(baseParams());
    const result = validateSchema(meta);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null', () => {
    const result = validateSchema(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('meta must be a non-null object');
  });

  it('rejects undefined', () => {
    const result = validateSchema(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('meta must be a non-null object');
  });

  it('rejects arrays', () => {
    const result = validateSchema([1, 2, 3]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('meta must be a non-null object');
  });

  it('rejects a primitive string', () => {
    const result = validateSchema('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('reports missing required string fields', () => {
    const result = validateSchema({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('eventId must be a non-empty string');
    expect(result.errors).toContain('source must be a non-empty string');
    expect(result.errors).toContain('entrypoint must be a non-empty string');
    expect(result.errors).toContain('timestamp must be a non-empty string');
    expect(result.errors).toContain('instruction must be a string');
    expect(result.errors).toContain('runMode must be a non-empty string');
    expect(result.errors).toContain('queueDepthAtIngress must be a finite number');
  });

  it('rejects empty required strings (except instruction)', () => {
    const raw = validRawMeta();
    raw['eventId'] = '';
    raw['source'] = '';
    raw['entrypoint'] = '';
    raw['runMode'] = '';
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('eventId must be a non-empty string');
    expect(result.errors).toContain('source must be a non-empty string');
    expect(result.errors).toContain('entrypoint must be a non-empty string');
    expect(result.errors).toContain('runMode must be a non-empty string');
  });

  it('allows empty instruction string', () => {
    const raw = validRawMeta();
    raw['instruction'] = '';
    const result = validateSchema(raw);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid source enum value', () => {
    const raw = validRawMeta();
    raw['source'] = 'unknown-source';
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('source must be one of'))).toBe(true);
  });

  it('rejects non-ISO timestamp', () => {
    const raw = validRawMeta();
    raw['timestamp'] = 'not-a-date';
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('timestamp must be a valid ISO 8601 date');
  });

  it('rejects NaN queueDepthAtIngress', () => {
    const raw = validRawMeta();
    raw['queueDepthAtIngress'] = NaN;
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('queueDepthAtIngress must be a finite number');
  });

  it('rejects Infinity queueDepthAtIngress', () => {
    const raw = validRawMeta();
    raw['queueDepthAtIngress'] = Infinity;
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
  });

  it('rejects non-number schemaVersion', () => {
    const raw = validRawMeta();
    raw['schemaVersion'] = 'one';
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('schemaVersion must be a number');
  });

  it('accepts missing schemaVersion (for unversioned data)', () => {
    const raw = validRawMeta();
    delete raw['schemaVersion'];
    const result = validateSchema(raw);
    expect(result.valid).toBe(true);
  });

  it('rejects wrong-type optional string fields', () => {
    const raw = validRawMeta();
    raw['requestId'] = 123;
    raw['callerIdentity'] = true;
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('requestId must be a string when present');
    expect(result.errors).toContain('callerIdentity must be a string when present');
  });

  it('rejects non-number retryAttempt', () => {
    const raw = validRawMeta();
    raw['retryAttempt'] = 'three';
    const result = validateSchema(raw);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('retryAttempt must be a finite number when present');
  });

  it('accepts valid optional fields', () => {
    const raw = validRawMeta();
    raw['requestId'] = 'req-1';
    raw['idempotencyKey'] = 'idem-1';
    raw['correlationId'] = 'corr-1';
    raw['retryOfEventId'] = 'orig-1';
    raw['retryAttempt'] = 2;
    raw['webhookDeliveryId'] = 'gh-1';
    raw['webhookEventType'] = 'push';
    raw['callerIdentity'] = 'user:max';
    const result = validateSchema(raw);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects multiple errors at once', () => {
    const result = validateSchema({ source: 999, queueDepthAtIngress: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// migrateSchema
// ---------------------------------------------------------------------------

describe('migrateSchema', () => {
  /** A complete valid v1 blob. */
  function validV1(): Record<string, unknown> {
    return {
      eventId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      source: 'invoke',
      entrypoint: '/api/invoke',
      timestamp: '2025-07-01T10:00:00.000Z',
      instruction: 'deploy staging',
      runMode: 'agent',
      queueDepthAtIngress: 3,
      schemaVersion: 1,
      requestId: 'req-x',
      callerIdentity: 'user:max',
    };
  }

  it('passes through a valid v1 object unchanged', () => {
    const input = validV1();
    const result = migrateSchema(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.eventId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(result.source).toBe('invoke');
    expect(result.entrypoint).toBe('/api/invoke');
    expect(result.timestamp).toBe('2025-07-01T10:00:00.000Z');
    expect(result.instruction).toBe('deploy staging');
    expect(result.runMode).toBe('agent');
    expect(result.queueDepthAtIngress).toBe(3);
    expect(result.requestId).toBe('req-x');
    expect(result.callerIdentity).toBe('user:max');
  });

  it('handles unversioned data (schemaVersion missing)', () => {
    const input = { ...validV1() };
    delete input['schemaVersion'];
    const result = migrateSchema(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.source).toBe('invoke');
  });

  it('handles schemaVersion: 0 (treated as unversioned)', () => {
    const input = { ...validV1(), schemaVersion: 0 };
    const result = migrateSchema(input);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('fills defaults for missing required fields', () => {
    const result = migrateSchema({ schemaVersion: 1 });
    expect(result.eventId).toMatch(UUID_RE);
    expect(result.source).toBe('api');
    expect(result.entrypoint).toBe('/unknown');
    expect(result.timestamp).toMatch(ISO_8601_RE);
    expect(result.instruction).toBe('');
    expect(result.runMode).toBe('auto');
    expect(result.queueDepthAtIngress).toBe(0);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('fills defaults for completely empty object', () => {
    const result = migrateSchema({});
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.source).toBe('api');
    expect(result.eventId).toMatch(UUID_RE);
  });

  it('coerces invalid source to api', () => {
    const result = migrateSchema({ ...validV1(), source: 'bogus' });
    expect(result.source).toBe('api');
  });

  it('coerces non-string eventId to generated UUID', () => {
    const result = migrateSchema({ ...validV1(), eventId: 42 });
    expect(result.eventId).toMatch(UUID_RE);
    expect(result.eventId).not.toBe('42');
  });

  it('coerces empty eventId to generated UUID', () => {
    const result = migrateSchema({ ...validV1(), eventId: '' });
    expect(result.eventId).toMatch(UUID_RE);
  });

  it('preserves all optional string fields', () => {
    const input = {
      ...validV1(),
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      retryOfEventId: 'orig-1',
      retryAttempt: 5,
      webhookDeliveryId: 'gh-d',
      webhookEventType: 'push',
    };
    const result = migrateSchema(input);
    expect(result.idempotencyKey).toBe('idem-1');
    expect(result.correlationId).toBe('corr-1');
    expect(result.retryOfEventId).toBe('orig-1');
    expect(result.retryAttempt).toBe(5);
    expect(result.webhookDeliveryId).toBe('gh-d');
    expect(result.webhookEventType).toBe('push');
  });

  it('drops non-string optional fields silently', () => {
    const input = { ...validV1(), requestId: 123, callerIdentity: false };
    const result = migrateSchema(input);
    expect(result.requestId).toBeUndefined();
    expect(result.callerIdentity).toBeUndefined();
  });

  it('throws on null input', () => {
    expect(() => migrateSchema(null)).toThrow('input must be a non-null object');
  });

  it('throws on undefined input', () => {
    expect(() => migrateSchema(undefined)).toThrow('input must be a non-null object');
  });

  it('throws on array input', () => {
    expect(() => migrateSchema([1, 2])).toThrow('input must be a non-null object');
  });

  it('throws on primitive input', () => {
    expect(() => migrateSchema('hello')).toThrow('input must be a non-null object');
    expect(() => migrateSchema(42)).toThrow('input must be a non-null object');
  });

  it('throws on future schema version', () => {
    expect(() => migrateSchema({ schemaVersion: 999 })).toThrow(
      'unsupported future schema version 999',
    );
  });

  it('result passes validateSchema', () => {
    const migrated = migrateSchema(validV1());
    const validation = validateSchema(migrated);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('migrated empty object passes validateSchema', () => {
    const migrated = migrateSchema({});
    const validation = validateSchema(migrated);
    expect(validation.valid).toBe(true);
  });

  it('round-trips with buildRunIngressMeta output', () => {
    const original = buildRunIngressMeta(baseParams({
      requestId: 'req-rt',
      correlationId: 'corr-rt',
      callerIdentity: 'user:roundtrip',
    }));
    const migrated = migrateSchema(original);
    expect(migrated.eventId).toBe(original.eventId);
    expect(migrated.source).toBe(original.source);
    expect(migrated.entrypoint).toBe(original.entrypoint);
    expect(migrated.timestamp).toBe(original.timestamp);
    expect(migrated.instruction).toBe(original.instruction);
    expect(migrated.runMode).toBe(original.runMode);
    expect(migrated.queueDepthAtIngress).toBe(original.queueDepthAtIngress);
    expect(migrated.schemaVersion).toBe(original.schemaVersion);
    expect(migrated.requestId).toBe(original.requestId);
    expect(migrated.correlationId).toBe(original.correlationId);
    expect(migrated.callerIdentity).toBe(original.callerIdentity);
  });
});
