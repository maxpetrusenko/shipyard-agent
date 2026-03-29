import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReportBenchResult {
  benchId: string;
  instruction: string;
  phase: string;
  durationMs: number;
  peakRssKb?: number | null;
  tokenUsage?: { input?: number; output?: number } | null;
  traceUrl?: string | null;
  filesChanged?: number;
  editToolCalls?: number | null;
  linesAdded?: number;
  linesRemoved?: number;
  error?: string | null;
  startedAt?: string;
  completedAt?: string;
  editTiers?: { tier1?: number; tier2?: number; tier3?: number; tier4?: number };
}

export interface ReportRunResult {
  runId: string;
  phase: string;
  durationMs: number;
  peakRssKb?: number | null;
  tokenUsage?: { input?: number; output?: number } | null;
  fileEdits?: Array<{ tier?: number }>;
  toolCallHistory?: Array<{ tool_name?: string; tool_result?: string }>;
  traceUrl?: string | null;
  error?: string | null;
  verificationResult?: {
    passed?: boolean;
    error_count?: number;
    newErrorCount?: number;
    typecheck_output?: string;
    test_output?: string;
  } | null;
  instruction?: string | null;
  messages?: Array<{ role?: string; content?: string }>;
  startedAt?: string;
  savedAt?: string;
  projectContext?: { projectId?: string; projectLabel?: string } | null;
}

export interface ResultRecord {
  kind: 'bench' | 'run' | 'snapshot';
  fileName: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ScoreboardRow {
  kind: 'bench' | 'run';
  id: string;
  instruction: string;
  status: string;
  durationMs: number;
  peakRssKb: number | null;
  tokenTotal: number;
  editCount: number;
  errorSummary: string;
  traceUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  timestamp: string;
}

function safeJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function latestUserInstruction(
  messages: Array<{ role?: string; content?: string }> | undefined,
): string | null {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return null;
}

export function readResultRecords(resultsDir: string | readonly string[]): ResultRecord[] {
  const records: ResultRecord[] = [];
  const dirs = Array.isArray(resultsDir) ? resultsDir : [resultsDir];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const fileName of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
      if (seen.has(fileName)) continue;
      seen.add(fileName);
      const fullPath = join(dir, fileName);
      const data = safeJson(fullPath);
      if (!data) continue;
      const kind = 'benchId' in data
        ? 'bench'
        : data['type'] === 'snapshot'
          ? 'snapshot'
          : 'run';
      const timestamp =
        typeof data['completedAt'] === 'string' ? data['completedAt']
        : typeof data['savedAt'] === 'string' ? data['savedAt']
        : typeof data['startedAt'] === 'string' ? data['startedAt']
        : typeof data['timestamp'] === 'string' ? data['timestamp']
        : '';
      records.push({ kind, fileName, timestamp, data });
    }
  }
  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function normalizeScoreboardRows(records: ResultRecord[]): ScoreboardRow[] {
  const rows: ScoreboardRow[] = [];
  for (const record of records) {
    if (record.kind === 'snapshot') continue;
    if (record.kind === 'bench') {
      const bench = record.data as unknown as ReportBenchResult;
      rows.push({
        kind: 'bench',
        id: bench.benchId,
        instruction: bench.instruction,
        status: bench.phase,
        durationMs: bench.durationMs ?? 0,
        peakRssKb: bench.peakRssKb ?? null,
        tokenTotal: (bench.tokenUsage?.input ?? 0) + (bench.tokenUsage?.output ?? 0),
        editCount: Number.isFinite(bench.editToolCalls) ? (bench.editToolCalls ?? 0) : (bench.filesChanged ?? 0),
        errorSummary: summarizeError(bench.error),
        traceUrl: bench.traceUrl ?? null,
        startedAt: bench.startedAt ?? null,
        completedAt: bench.completedAt ?? record.timestamp ?? null,
        timestamp: record.timestamp,
      });
      continue;
    }

    const run = record.data as unknown as ReportRunResult;
    rows.push({
      kind: 'run',
      id: run.runId,
      instruction: summarizeInstruction(
        run.instruction?.trim() || latestUserInstruction(run.messages),
      ),
      status: run.phase,
      durationMs: run.durationMs ?? 0,
      peakRssKb: run.peakRssKb ?? null,
      tokenTotal: (run.tokenUsage?.input ?? 0) + (run.tokenUsage?.output ?? 0),
      editCount: countMutationToolCalls(run.toolCallHistory) || run.fileEdits?.length || 0,
      errorSummary: summarizeRunError(run),
      traceUrl: run.traceUrl ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: record.timestamp || run.savedAt || null,
      timestamp: record.timestamp,
    });
  }
  return rows;
}

export function summarizeInstruction(value: string | null | undefined, max = 140): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '(instruction unavailable in persisted run)';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export function summarizeError(value: string | null | undefined): string {
  if (!value || value === 'null') return 'none';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

export function summarizeRunError(run: ReportRunResult): string {
  const direct = summarizeError(run.error);
  if (direct !== 'none') return direct;
  const verification = run.verificationResult;
  if (!verification) return 'none';
  const newErrors = verification.newErrorCount ?? verification.error_count ?? 0;
  if (newErrors > 0) return `${newErrors} verification error(s)`;
  if (verification.passed === false) return 'verification failed';
  return 'none';
}

function isMutationToolName(value: string | undefined): boolean {
  return value === 'edit_file' || value === 'write_file';
}

function countMutationToolCalls(
  history: Array<{ tool_name?: string; tool_result?: string }> | null | undefined,
): number {
  if (!Array.isArray(history)) return 0;
  return history.filter((entry) => isMutationToolName(entry?.tool_name)).length;
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0s';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatRss(peakRssKb: number | null | undefined): string {
  if (!Number.isFinite(peakRssKb) || !peakRssKb || peakRssKb <= 0) return '—';
  if (peakRssKb >= 1024 * 1024) return `${(peakRssKb / (1024 * 1024)).toFixed(2)} GB`;
  return `${(peakRssKb / 1024).toFixed(0)} MB`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const hour = map.get('hour') === '24' ? '00' : (map.get('hour') ?? '00');
  return `${map.get('year') ?? '0000'}-${map.get('month') ?? '00'}-${map.get('day') ?? '00'} ${hour}:${map.get('minute') ?? '00'}:${map.get('second') ?? '00'} CT`;
}

export function formatTrace(traceUrl: string | null): string {
  return traceUrl ? `[trace](${traceUrl})` : '—';
}

export function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}
