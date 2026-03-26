import type { Router } from 'express';
import type { InstructionLoop } from '../runtime/loop.js';
import { DedupeStore } from './dedupe-store.js';
import { EventIndex } from './event-index.js';
import { EventPersistence } from './event-persistence.js';
import { DeadLetterQueue } from './dead-letter.js';
import { MemoryGuard } from './memory-guard.js';
import { registerInvokeHandlers } from './invoke-handler.js';
import { registerWebhookHandlers } from './webhook-handler.js';
import { registerRetryHandlers } from './retry-handler.js';
import { registerOperationalHandlers } from './operational-handler.js';
import type { InvokeEvent } from './invoke-shared.js';

export interface InvokeRoutesCleanup {
  memoryGuard: MemoryGuard;
  dedupeStore: DedupeStore;
  deadLetterQueue: DeadLetterQueue;
  eventPersistence: EventPersistence;
}

export function registerInvokeRoutes(router: Router, loop: InstructionLoop): InvokeRoutesCleanup {
  const eventIndex = new EventIndex<InvokeEvent>(['source', 'eventType', 'status']);
  const dedupeStore = new DedupeStore();
  const eventPersistence = new EventPersistence();
  const deadLetterQueue = new DeadLetterQueue();
  const memoryGuard = new MemoryGuard({
    getEventCount: () => eventIndex.size(),
    getQueueDepth: () => loop.getStatus().queueLength,
  });

  try { dedupeStore.loadFromDisk(); } catch { /* noop */ }
  try { deadLetterQueue.loadFromDisk(); } catch { /* noop */ }
  try {
    const restored = eventPersistence.loadEventsFromFiles();
    for (const ev of restored) eventIndex.add(ev as unknown as InvokeEvent);
  } catch { /* noop */ }

  memoryGuard.start();

  const deps = {
    loop,
    eventIndex,
    dedupeStore,
    eventPersistence,
    deadLetterQueue,
    memoryGuard,
    maxInvokeEvents: parseInt(process.env['SHIPYARD_INVOKE_EVENT_MAX'] ?? '1000', 10) || 1000,
  };

  registerInvokeHandlers(router, deps);
  registerWebhookHandlers(router, deps);
  registerRetryHandlers(router, deps);
  registerOperationalHandlers(router, deps);

  return { memoryGuard, dedupeStore, deadLetterQueue, eventPersistence };
}
