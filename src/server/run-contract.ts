/**
 * Unified "autonomous run contract" for all ingress paths.
 *
 * Every ingress (POST /run, /invoke, /invoke/batch, /github/webhook,
 * retry, retry-batch) emits an identical RunIngressMeta shape so
 * downstream consumers (persistence, observability, dashboard) get
 * a consistent object regardless of how the run was triggered.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current schema version. Bump when RunIngressMeta shape changes. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IngressSource =
  | 'api'
  | 'invoke'
  | 'webhook'
  | 'retry'
  | 'retry-batch'
  | 'batch';

export interface RunIngressMeta {
  /** Unique event ID (uuid). */
  eventId: string;
  /** Which ingress surface accepted the request. */
  source: IngressSource;
  /** Route path, e.g. '/api/run', '/api/invoke', '/github/webhook'. */
  entrypoint: string;
  /** ISO 8601 timestamp of when the event was received. */
  timestamp: string;
  /** The instruction text submitted. */
  instruction: string;
  /** Run classification: ask / plan / agent / auto / chat / code. */
  runMode: string;
  /** From X-Request-Id header (if present). */
  requestId?: string;
  /** From X-Idempotency-Key header (if present). */
  idempotencyKey?: string;
  /** Trace correlation ID (for future use). */
  correlationId?: string;
  /** If this is a retry, the original event ID. */
  retryOfEventId?: string;
  /** Retry attempt number. */
  retryAttempt?: number;
  /** GitHub delivery ID (webhook only). */
  webhookDeliveryId?: string;
  /** GitHub event type (webhook only). */
  webhookEventType?: string;
  /** Who triggered the run (user, webhook sender, etc.). */
  callerIdentity?: string;
  /** Queue depth at the moment this event arrived. */
  queueDepthAtIngress: number;
  /** Schema version for forward-compatible evolution. */
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Builder params
// ---------------------------------------------------------------------------

export interface BuildRunIngressMetaParams {
  source: IngressSource;
  entrypoint: string;
  instruction: string;
  runMode: string;
  queueDepthAtIngress: number;

  /** Optional overrides / extras. */
  eventId?: string;
  timestamp?: string;
  requestId?: string;
  idempotencyKey?: string;
  correlationId?: string;
  retryOfEventId?: string;
  retryAttempt?: number;
  webhookDeliveryId?: string;
  webhookEventType?: string;
  callerIdentity?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a fully-populated RunIngressMeta from the given parameters.
 * Fills defaults for eventId, timestamp, and schemaVersion.
 */
export function buildRunIngressMeta(params: BuildRunIngressMetaParams): RunIngressMeta {
  const meta: RunIngressMeta = {
    eventId: params.eventId ?? randomUUID(),
    source: params.source,
    entrypoint: params.entrypoint,
    timestamp: params.timestamp ?? new Date().toISOString(),
    instruction: params.instruction,
    runMode: params.runMode,
    queueDepthAtIngress: params.queueDepthAtIngress,
    schemaVersion: 1,
  };

  if (params.requestId !== undefined) meta.requestId = params.requestId;
  if (params.idempotencyKey !== undefined) meta.idempotencyKey = params.idempotencyKey;
  if (params.correlationId !== undefined) meta.correlationId = params.correlationId;
  if (params.retryOfEventId !== undefined) meta.retryOfEventId = params.retryOfEventId;
  if (params.retryAttempt !== undefined) meta.retryAttempt = params.retryAttempt;
  if (params.webhookDeliveryId !== undefined) meta.webhookDeliveryId = params.webhookDeliveryId;
  if (params.webhookEventType !== undefined) meta.webhookEventType = params.webhookEventType;
  if (params.callerIdentity !== undefined) meta.callerIdentity = params.callerIdentity;

  return meta;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SOURCES: ReadonlySet<string> = new Set<IngressSource>([
  'api', 'invoke', 'webhook', 'retry', 'retry-batch', 'batch',
]);

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that an unknown value conforms to the RunIngressMeta schema.
 * Returns a list of human-readable errors (empty when valid).
 */
export function validateSchema(meta: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) {
    return { valid: false, errors: ['meta must be a non-null object'] };
  }

  const obj = meta as Record<string, unknown>;

  // Required string fields
  const requiredStrings: Array<[string, string]> = [
    ['eventId', 'eventId must be a non-empty string'],
    ['source', 'source must be a non-empty string'],
    ['entrypoint', 'entrypoint must be a non-empty string'],
    ['timestamp', 'timestamp must be a non-empty string'],
    ['instruction', 'instruction must be a string'],
    ['runMode', 'runMode must be a non-empty string'],
  ];

  for (const [key, msg] of requiredStrings) {
    if (typeof obj[key] !== 'string') {
      errors.push(msg);
    } else if (key !== 'instruction' && (obj[key] as string).length === 0) {
      errors.push(msg);
    }
  }

  // source enum check
  if (typeof obj['source'] === 'string' && !VALID_SOURCES.has(obj['source'])) {
    errors.push(`source must be one of: ${[...VALID_SOURCES].join(', ')}`);
  }

  // timestamp ISO 8601 check
  if (typeof obj['timestamp'] === 'string') {
    const d = new Date(obj['timestamp'] as string);
    if (Number.isNaN(d.getTime())) {
      errors.push('timestamp must be a valid ISO 8601 date');
    }
  }

  // queueDepthAtIngress
  if (typeof obj['queueDepthAtIngress'] !== 'number' || !Number.isFinite(obj['queueDepthAtIngress'] as number)) {
    errors.push('queueDepthAtIngress must be a finite number');
  }

  // schemaVersion
  if (obj['schemaVersion'] !== undefined && typeof obj['schemaVersion'] !== 'number') {
    errors.push('schemaVersion must be a number');
  }

  // Optional string fields
  const optionalStrings = [
    'requestId', 'idempotencyKey', 'correlationId',
    'retryOfEventId', 'webhookDeliveryId', 'webhookEventType', 'callerIdentity',
  ];
  for (const key of optionalStrings) {
    if (obj[key] !== undefined && typeof obj[key] !== 'string') {
      errors.push(`${key} must be a string when present`);
    }
  }

  // retryAttempt
  if (obj['retryAttempt'] !== undefined) {
    if (typeof obj['retryAttempt'] !== 'number' || !Number.isFinite(obj['retryAttempt'] as number)) {
      errors.push('retryAttempt must be a finite number when present');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate an unknown metadata blob to the current schema version.
 *
 * Strategy:
 * - v1 (current): pass-through with validation + defaults for missing fields.
 * - Unknown / missing version: treat as v1 with best-effort field extraction.
 *
 * When new versions are added, each step migrates v(N) -> v(N+1)
 * sequentially until reaching CURRENT_SCHEMA_VERSION.
 *
 * Throws if the input is not a usable object at all.
 */
export function migrateSchema(meta: unknown): RunIngressMeta {
  if (meta === null || meta === undefined || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('migrateSchema: input must be a non-null object');
  }

  const obj = meta as Record<string, unknown>;
  const version = typeof obj['schemaVersion'] === 'number' ? obj['schemaVersion'] : 0;

  // Currently only v0 (unversioned) and v1 exist. Both resolve to v1.
  // Future migrations: if (version < 2) { ... migrate v1 -> v2 ... }

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `migrateSchema: unsupported future schema version ${version} (current: ${CURRENT_SCHEMA_VERSION})`,
    );
  }

  // Extract / coerce fields with safe defaults for missing data.
  const eventId = typeof obj['eventId'] === 'string' && obj['eventId']
    ? obj['eventId'] as string
    : randomUUID();

  const source: IngressSource = typeof obj['source'] === 'string' && VALID_SOURCES.has(obj['source'])
    ? obj['source'] as IngressSource
    : 'api';

  const entrypoint = typeof obj['entrypoint'] === 'string' && obj['entrypoint']
    ? obj['entrypoint'] as string
    : '/unknown';

  const timestamp = typeof obj['timestamp'] === 'string' && obj['timestamp']
    ? obj['timestamp'] as string
    : new Date().toISOString();

  const instruction = typeof obj['instruction'] === 'string'
    ? obj['instruction'] as string
    : '';

  const runMode = typeof obj['runMode'] === 'string' && obj['runMode']
    ? obj['runMode'] as string
    : 'auto';

  const queueDepthAtIngress = typeof obj['queueDepthAtIngress'] === 'number'
    && Number.isFinite(obj['queueDepthAtIngress'] as number)
    ? obj['queueDepthAtIngress'] as number
    : 0;

  const result: RunIngressMeta = {
    eventId,
    source,
    entrypoint,
    timestamp,
    instruction,
    runMode,
    queueDepthAtIngress,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  // Carry over optional fields if present and valid
  if (typeof obj['requestId'] === 'string') result.requestId = obj['requestId'] as string;
  if (typeof obj['idempotencyKey'] === 'string') result.idempotencyKey = obj['idempotencyKey'] as string;
  if (typeof obj['correlationId'] === 'string') result.correlationId = obj['correlationId'] as string;
  if (typeof obj['retryOfEventId'] === 'string') result.retryOfEventId = obj['retryOfEventId'] as string;
  if (typeof obj['retryAttempt'] === 'number') result.retryAttempt = obj['retryAttempt'] as number;
  if (typeof obj['webhookDeliveryId'] === 'string') result.webhookDeliveryId = obj['webhookDeliveryId'] as string;
  if (typeof obj['webhookEventType'] === 'string') result.webhookEventType = obj['webhookEventType'] as string;
  if (typeof obj['callerIdentity'] === 'string') result.callerIdentity = obj['callerIdentity'] as string;

  return result;
}
