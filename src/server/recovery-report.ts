/** Recovery report computation after server restart. Pure functions only. */

export interface RecoveryReport {
  /** When the recovery was performed */
  recoveredAt: string;
  /** Number of events recovered from disk */
  eventsRecovered: number;
  /** Number of dedupe keys recovered from disk */
  dedupeKeysRecovered: number;
  /** Breakdown by event status */
  byStatus: Record<string, number>;
  /** Breakdown by event source */
  bySource: Record<string, number>;
  /** Oldest event recovered */
  oldestEventAt: string | null;
  /** Newest event recovered */
  newestEventAt: string | null;
  /** Time taken for recovery in ms */
  durationMs: number;
  /** Index rebuild stats */
  indexRebuildStats: {
    totalIndexed: number;
    duplicatesSkipped: number;
    parseErrors: number;
  };
}

export interface RecoveryEvent {
  id: string;
  source: string;
  status: string;
  receivedAt: string;
}

export interface BuildRecoveryReportOpts {
  events: RecoveryEvent[];
  dedupeKeyCount: number;
  durationMs: number;
  parseErrors?: number;
  duplicatesSkipped?: number;
}

/** Build a recovery report from already-loaded event data. Pure, no I/O. */
export function buildRecoveryReport(opts: BuildRecoveryReportOpts): RecoveryReport {
  const { events, dedupeKeyCount, durationMs, parseErrors = 0, duplicatesSkipped = 0 } = opts;

  const byStatus: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const ev of events) {
    byStatus[ev.status] = (byStatus[ev.status] ?? 0) + 1;
    bySource[ev.source] = (bySource[ev.source] ?? 0) + 1;

    if (oldest === null || ev.receivedAt < oldest) {
      oldest = ev.receivedAt;
    }
    if (newest === null || ev.receivedAt > newest) {
      newest = ev.receivedAt;
    }
  }

  return {
    recoveredAt: new Date().toISOString(),
    eventsRecovered: events.length,
    dedupeKeysRecovered: dedupeKeyCount,
    byStatus,
    bySource,
    oldestEventAt: oldest,
    newestEventAt: newest,
    durationMs,
    indexRebuildStats: {
      totalIndexed: events.length,
      duplicatesSkipped,
      parseErrors,
    },
  };
}

/** Returns route metadata so the caller can wire it into a router. */
export function getRecoveryReportRoute(): { method: 'get'; path: string } {
  return { method: 'get', path: '/recovery/report' };
}
