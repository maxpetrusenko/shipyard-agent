/**
 * Memory pressure guardrails.
 *
 * Periodically samples process.memoryUsage() and classifies heap into
 * normal / elevated / critical. Fires callbacks on pressure transitions
 * and increments OPS counters so the /metrics endpoint surfaces them.
 *
 * Thresholds are configurable via env:
 *   SHIPYARD_MEMORY_ELEVATED_MB  (default 512)
 *   SHIPYARD_MEMORY_CRITICAL_MB  (default 1024)
 */

import { OPS } from './ops.js';
import { getHeapStatistics } from 'node:v8';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PressureLevel = 'normal' | 'elevated' | 'critical';

export interface MemoryPressure {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMemMB: number;
  eventCount: number;
  queueDepth: number;
  pressure: PressureLevel;
  thresholds: { elevated: number; critical: number };
}

export interface MemoryGuardOptions {
  elevatedMB?: number;
  criticalMB?: number;
  heapSizeLimitMB?: number;
  intervalMs?: number;
  /** Inject current event count (used by routes layer). */
  getEventCount?: () => number;
  /** Inject current queue depth (used by loop). */
  getQueueDepth?: () => number;
}

// ---------------------------------------------------------------------------
// Metric keys
// ---------------------------------------------------------------------------

export const MEMORY_METRICS = {
  PRESSURE_ELEVATED: 'shipyard.memory.pressure_elevated',
  PRESSURE_CRITICAL: 'shipyard.memory.pressure_critical',
  EVENTS_BACKLOG_SIZE: 'shipyard.events.backlog_size',
  QUEUE_DEPTH: 'shipyard.queue.depth',
} as const;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function toMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export class MemoryGuard {
  private readonly elevatedThresholdMB: number;
  private readonly criticalThresholdMB: number;
  private readonly checkIntervalMs: number;
  private readonly getEventCount: () => number;
  private readonly getQueueDepth: () => number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPressure: PressureLevel = 'normal';
  private listeners: Array<(pressure: MemoryPressure) => void> = [];

  constructor(opts?: MemoryGuardOptions) {
    const heapLimitMB = opts?.heapSizeLimitMB ?? toMB(getHeapStatistics().heap_size_limit);
    const defaultElevated = Math.round(heapLimitMB * 0.7 * 100) / 100;
    const defaultCritical = Math.round(heapLimitMB * 0.9 * 100) / 100;
    this.elevatedThresholdMB = opts?.elevatedMB ?? envInt('SHIPYARD_MEMORY_ELEVATED_MB', defaultElevated);
    this.criticalThresholdMB = opts?.criticalMB ?? envInt('SHIPYARD_MEMORY_CRITICAL_MB', defaultCritical);
    this.checkIntervalMs = opts?.intervalMs ?? envInt('SHIPYARD_MEMORY_CHECK_INTERVAL_MS', 30_000);
    this.getEventCount = opts?.getEventCount ?? (() => 0);
    this.getQueueDepth = opts?.getQueueDepth ?? (() => 0);
  }

  /** Begin periodic memory sampling. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    // Unref so it doesn't keep the process alive.
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** Stop periodic checks. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Take a one-shot snapshot of current memory pressure. */
  check(): MemoryPressure {
    const mem = process.memoryUsage();
    const heapUsedMB = toMB(mem.heapUsed);
    const heapTotalMB = toMB(mem.heapTotal);
    const rssMemMB = toMB(mem.rss);
    const eventCount = this.getEventCount();
    const queueDepth = this.getQueueDepth();

    let pressure: PressureLevel = 'normal';
    if (heapUsedMB >= this.criticalThresholdMB) {
      pressure = 'critical';
    } else if (heapUsedMB >= this.elevatedThresholdMB) {
      pressure = 'elevated';
    }

    return {
      heapUsedMB,
      heapTotalMB,
      rssMemMB,
      eventCount,
      queueDepth,
      pressure,
      thresholds: {
        elevated: this.elevatedThresholdMB,
        critical: this.criticalThresholdMB,
      },
    };
  }

  /** Register a callback that fires when pressure level transitions. */
  onPressureChange(cb: (pressure: MemoryPressure) => void): void {
    this.listeners.push(cb);
  }

  /** Gauges snapshot for /metrics (non-cumulative, current values). */
  gauges(): Record<string, number> {
    const snap = this.check();
    return {
      [MEMORY_METRICS.EVENTS_BACKLOG_SIZE]: snap.eventCount,
      [MEMORY_METRICS.QUEUE_DEPTH]: snap.queueDepth,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private tick(): void {
    const snap = this.check();
    const prev = this.lastPressure;

    if (snap.pressure !== prev) {
      this.lastPressure = snap.pressure;

      if (snap.pressure === 'elevated') {
        OPS.increment(MEMORY_METRICS.PRESSURE_ELEVATED);
      }
      if (snap.pressure === 'critical') {
        OPS.increment(MEMORY_METRICS.PRESSURE_CRITICAL);
        console.error(
          `[memory-guard] CRITICAL memory pressure: heap ${snap.heapUsedMB}MB / ${snap.heapTotalMB}MB, RSS ${snap.rssMemMB}MB`,
        );
      }

      for (const cb of this.listeners) {
        try {
          cb(snap);
        } catch {
          // Listener errors must not break the guard loop.
        }
      }
    }
  }
}
