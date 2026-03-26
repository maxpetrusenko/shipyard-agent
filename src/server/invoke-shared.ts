import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';
import { OPS } from './ops.js';
import { EventIndex } from './event-index.js';
import { EventPersistence, type PersistedInvokeEvent } from './event-persistence.js';
import { DeadLetterQueue } from './dead-letter.js';
import { DedupeStore } from './dedupe-store.js';
import { MemoryGuard } from './memory-guard.js';
import type { RunIngressMeta } from './run-contract.js';

export interface InvokeEvent {
  id: string;
  source: string;
  eventType: string;
  status: string;
  instruction: string;
  runId?: string;
  metadata: Record<string, unknown>;
  receivedAt: string;
  completedAt?: string;
  retryAttempts: number;
  retryOfEventId?: string;
  ingress?: RunIngressMeta;
}

export interface InvokeRoutesDeps {
  loop: InstructionLoop;
  eventIndex: EventIndex<InvokeEvent>;
  dedupeStore: DedupeStore;
  eventPersistence: EventPersistence;
  deadLetterQueue: DeadLetterQueue;
  memoryGuard: MemoryGuard;
  maxInvokeEvents: number;
}

export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export function recordInvokeEvent(
  eventIndex: EventIndex<InvokeEvent>,
  eventPersistence: EventPersistence,
  maxInvokeEvents: number,
  event: InvokeEvent,
): void {
  eventIndex.add(event);
  eventPersistence.persistEvent(event as unknown as PersistedInvokeEvent);
  while (eventIndex.size() > maxInvokeEvents) {
    const all = eventIndex.all();
    if (all.length === 0) break;
    eventIndex.remove(all[all.length - 1]!.id);
  }
  OPS.increment('shipyard.events.stored');
}

export function applyTimeWindow<T extends { receivedAt: string }>(
  events: T[],
  fromIso: string | undefined,
  toIso: string | undefined,
): T[] {
  const fromMs = fromIso ? Date.parse(fromIso) : NaN;
  const toMs = toIso ? Date.parse(toIso) : NaN;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);
  if (!hasFrom && !hasTo) return events;
  return events.filter((event) => {
    const ts = Date.parse(event.receivedAt);
    if (!Number.isFinite(ts)) return false;
    if (hasFrom && ts < fromMs) return false;
    if (hasTo && ts > toMs) return false;
    return true;
  });
}

let versionCache: string | null = null;
export function getPackageVersion(): string {
  if (versionCache) return versionCache;
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version?: string };
    versionCache = pkg.version ?? '0.0.0';
  } catch {
    versionCache = '0.0.0';
  }
  return versionCache;
}
