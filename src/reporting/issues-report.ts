import { readFileSync } from 'node:fs';
import {
  escapeCell,
  formatTrace,
  readResultRecords,
  summarizeError,
  type ReportRunResult,
} from './result-files.js';

export interface SeedIssueRun {
  id: string;
  traceUrl?: string | null;
}

export interface SeedIssue {
  id: string;
  symptom: string;
  rootCause: string;
  addressed?: string;
  status: 'fixed' | 'open' | 'workaround';
  patchStatus?: 'patched' | 'open' | 'workaround';
  testStatus?: 'verified' | 'pending' | 'triage';
  benchmarkStatus?: 'verified' | 'pending' | 'triage';
  runs: SeedIssueRun[];
}

export interface IssueRow {
  patchStatus: 'patched' | 'open' | 'workaround';
  testStatus: 'verified' | 'pending' | 'triage';
  benchmarkStatus: 'verified' | 'pending' | 'triage';
  symptom: string;
  rootCause: string;
  notes: string;
  runIds: string[];
  traceUrl: string | null;
}

function normalizeSymptom(text: string): string {
  return text
    .toLowerCase()
    .replace(/\/users\/[^\s)]+/g, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<id>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readIssueSeed(seedPath: string): SeedIssue[] {
  return JSON.parse(readFileSync(seedPath, 'utf8')) as SeedIssue[];
}

function buildSeedRows(seed: SeedIssue[]): IssueRow[] {
  return seed.map((item) => ({
    patchStatus:
      item.patchStatus ??
      (item.status === 'fixed' ? 'patched' : item.status),
    testStatus: item.testStatus ?? 'pending',
    benchmarkStatus: item.benchmarkStatus ?? 'pending',
    symptom: item.symptom,
    rootCause: item.rootCause,
    notes: item.addressed ?? '—',
    runIds: item.runs.map((run) => run.id),
    traceUrl: item.runs.find((run) => run.traceUrl)?.traceUrl ?? null,
  }));
}

function buildObservedRows(resultsDir: string, seed: SeedIssue[]): IssueRow[] {
  const seedKeys = new Set(seed.map((item) => normalizeSymptom(item.symptom)));
  const seededRunIds = new Set(seed.flatMap((item) => item.runs.map((run) => run.id)));
  const deduped = new Map<string, IssueRow>();
  const records = readResultRecords(resultsDir);

  for (const record of records) {
    if (record.kind !== 'run') continue;
    const run = record.data as unknown as ReportRunResult;
    const summary = summarizeError(run.error);
    if (summary === 'none') continue;
    if (seededRunIds.has(run.runId)) continue;
    const key = normalizeSymptom(summary);
    if (seedKeys.has(key) || deduped.has(key)) continue;
    deduped.set(key, {
      patchStatus: 'open',
      testStatus: 'triage',
      benchmarkStatus: 'triage',
      symptom: summary,
      rootCause: 'Triage pending from persisted run data.',
      notes: 'Pending triage.',
      runIds: [run.runId],
      traceUrl: run.traceUrl ?? null,
    });
  }

  return [...deduped.values()].slice(0, 12);
}

function rowToMarkdown(row: IssueRow): string {
  return `| ${row.patchStatus} | ${row.testStatus} | ${row.benchmarkStatus} | ${escapeCell(row.symptom)} | ${escapeCell(row.rootCause)} | ${escapeCell(row.notes)} | ${escapeCell(row.runIds.join(', '))} | ${formatTrace(row.traceUrl)} |`;
}

export function renderIssuesReport(
  resultsDir: string,
  seedPath: string,
  generatedAt: string = new Date().toISOString(),
): string {
  const seed = readIssueSeed(seedPath);
  const seededRows = buildSeedRows(seed);
  const observedRows = buildObservedRows(resultsDir, seed);

  return [
    '# Issues',
    '',
    `Generated: ${generatedAt}`,
    '',
    'Living failure catalog for rebuild and benchmark runs.',
    '',
    'Status split: patch = code landed, tests = targeted verification, benchmark = rerun evidence.',
    '',
    '## Seeded Issues',
    '',
    '| Patch | Tests | Benchmark | Symptom | Root Cause | Notes | Run(s) | Trace |',
    '|---|---|---|---|---|---|---|---|',
    ...seededRows.map(rowToMarkdown),
    '',
    '## Auto-Detected Recent Failures',
    '',
    observedRows.length > 0
      ? '| Patch | Tests | Benchmark | Symptom | Root Cause | Notes | Run(s) | Trace |'
      : '_No additional recent failures detected from persisted results._',
    ...(observedRows.length > 0 ? ['|---|---|---|---|---|---|---|---|', ...observedRows.map(rowToMarkdown)] : []),
    '',
  ].join('\n');
}
