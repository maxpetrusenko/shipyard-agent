/**
 * Error-budget dashboard summary computation.
 *
 * Pure, standalone module with no side effects.
 * Computes failure/queue-full rates over a sliding time window
 * and returns a budget snapshot for the dashboard.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorBudgetEvent {
  status: string;
  receivedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorBudgetSnapshot {
  failureRate5m: number;
  queueFullRate5m: number;
  totalEvents5m: number;
  totalFailures5m: number;
  totalQueueFull5m: number;
  budgetRemaining: number;
  status: 'healthy' | 'warning' | 'critical';
  windowMs: number;
  computedAt: string;
}

export interface ErrorBudgetRouteDescriptor {
  method: 'get';
  path: string;
  handler: (events: ErrorBudgetEvent[]) => ErrorBudgetSnapshot;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 300_000; // 5 minutes
const WARNING_THRESHOLD = 0.05;    // 5%
const CRITICAL_THRESHOLD = 0.20;   // 20%

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isQueueFullEvent(event: ErrorBudgetEvent): boolean {
  if (!event.metadata) return false;
  const code = event.metadata['code'] ?? event.metadata['reasonCode'];
  if (typeof code === 'string' && code.toLowerCase().includes('queue_full')) {
    return true;
  }
  const error = event.metadata['error'];
  if (typeof error === 'string' && error.toLowerCase().includes('queue full')) {
    return true;
  }
  const reason = event.metadata['reason'];
  if (typeof reason === 'string' && reason.toLowerCase().includes('queue')) {
    return true;
  }
  return false;
}

function resolveStatus(failureRate: number): 'healthy' | 'warning' | 'critical' {
  if (failureRate >= CRITICAL_THRESHOLD) return 'critical';
  if (failureRate >= WARNING_THRESHOLD) return 'warning';
  return 'healthy';
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Compute error-budget snapshot from a list of events.
 *
 * Pure function: no side effects, no imports from runtime modules.
 */
export function computeErrorBudget(
  events: ErrorBudgetEvent[],
  windowMs: number = DEFAULT_WINDOW_MS,
): ErrorBudgetSnapshot {
  const now = Date.now();
  const cutoff = now - windowMs;

  const inWindow = events.filter((ev) => {
    const ts = Date.parse(ev.receivedAt);
    return Number.isFinite(ts) && ts >= cutoff;
  });

  const totalEvents5m = inWindow.length;
  let totalFailures5m = 0;
  let totalQueueFull5m = 0;

  for (const ev of inWindow) {
    if (ev.status === 'rejected') {
      totalFailures5m++;
    }
    if (isQueueFullEvent(ev)) {
      totalQueueFull5m++;
    }
  }

  const failureRate5m = totalEvents5m > 0 ? totalFailures5m / totalEvents5m : 0;
  const queueFullRate5m = totalEvents5m > 0 ? totalQueueFull5m / totalEvents5m : 0;

  return {
    failureRate5m,
    queueFullRate5m,
    totalEvents5m,
    totalFailures5m,
    totalQueueFull5m,
    budgetRemaining: 1 - failureRate5m,
    status: resolveStatus(failureRate5m),
    windowMs,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Route descriptor
// ---------------------------------------------------------------------------

/**
 * Returns route metadata for wiring into invoke-routes.ts.
 * The handler is a pure function that accepts the events array.
 */
export function getErrorBudgetRoute(): ErrorBudgetRouteDescriptor {
  return {
    method: 'get',
    path: '/invoke/events/error-budget',
    handler: (events) => computeErrorBudget(events),
  };
}
