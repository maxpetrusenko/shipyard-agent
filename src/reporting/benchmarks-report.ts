import {
  escapeCell,
  formatDuration,
  formatRss,
  formatTimestamp,
  formatTrace,
  normalizeScoreboardRows,
  readResultRecords,
  type ResultRecord,
  type ReportRunResult,
  type ScoreboardRow,
} from './result-files.js';
import { hasBenchmarkProjectContext, resolveBenchmarkResultsDirs } from './benchmark-scope.js';

export const REBUILD_INSTRUCTION_NAMES = [
  '03-database-schema-and-migrations',
  '04-auth-and-session-management',
  '05-document-crud-api',
  '06-realtime-collaboration',
  '07-react-frontend-shell',
  '08-tiptap-rich-text-editor',
  '09-file-uploads-and-comments',
] as const;

function humanInstruction(name: string): string {
  return name
    .replace(/^\d+-/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function benchRowScore(row: ScoreboardRow): number {
  const doneScore = row.status === 'done' ? 1_000_000_000_000 : 0;
  const errorPenalty = row.errorSummary === 'none' ? 100_000_000_000 : 0;
  const durationScore = Math.max(0, 10_000_000 - row.durationMs);
  const tokenScore = Math.max(0, 1_000_000 - row.tokenTotal);
  const editScore = Math.max(0, 10_000 - row.editCount);
  const recencyScore = row.completedAt ? Date.parse(row.completedAt) || 0 : 0;
  return doneScore + errorPenalty + durationScore + tokenScore + editScore + recencyScore;
}

function latestBenchByInstruction(rows: ScoreboardRow[]): Map<string, ScoreboardRow> {
  const map = new Map<string, ScoreboardRow>();
  for (const row of rows) {
    if (row.kind !== 'bench') continue;
    if (!map.has(row.instruction)) map.set(row.instruction, row);
  }
  return map;
}

function bestBenchByInstruction(rows: ScoreboardRow[]): Map<string, ScoreboardRow> {
  const map = new Map<string, ScoreboardRow>();
  for (const row of rows) {
    if (row.kind !== 'bench') continue;
    const current = map.get(row.instruction);
    if (!current || benchRowScore(row) > benchRowScore(current)) {
      map.set(row.instruction, row);
    }
  }
  return map;
}

function latestRebuildStepTimestamp(rows: ScoreboardRow[], selector: (rows: ScoreboardRow[]) => Map<string, ScoreboardRow>): string | null {
  const latest = selector(rows);
  const timestamps = REBUILD_INSTRUCTION_NAMES
    .map((name) => latest.get(name)?.completedAt ?? latest.get(name)?.startedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a));
  return timestamps[0] ?? null;
}

function buildRebuildTable(
  rows: ScoreboardRow[],
  selector: (rows: ScoreboardRow[]) => Map<string, ScoreboardRow>,
): string[] {
  const selected = selector(rows);
  return REBUILD_INSTRUCTION_NAMES.map((name) => {
    const row = selected.get(name);
    if (!row) {
      return `| ${escapeCell(humanInstruction(name))} | not run | — | — | 0s | — | 0 | 0 | none | — |`;
    }
    return `| ${escapeCell(humanInstruction(name))} | ${escapeCell(row.status)} | ${formatTimestamp(row.startedAt)} | ${formatTimestamp(row.completedAt)} | ${formatDuration(row.durationMs)} | ${formatRss(row.peakRssKb)} | ${row.tokenTotal} | ${row.editCount} | ${escapeCell(row.errorSummary)} | ${formatTrace(row.traceUrl)} |`;
  });
}

function buildRecentRunsTable(rows: ScoreboardRow[]): string[] {
  return rows.slice(0, 20).map((row) =>
    `| ${escapeCell(row.kind)} | ${escapeCell(row.instruction)} | ${escapeCell(row.status)} | ${formatTimestamp(row.startedAt)} | ${formatTimestamp(row.completedAt)} | ${formatDuration(row.durationMs)} | ${formatRss(row.peakRssKb)} | ${row.tokenTotal} | ${row.editCount} | ${escapeCell(row.errorSummary)} | ${formatTrace(row.traceUrl)} |`,
  );
}

function latestSwarmRunRows(records: ResultRecord[]): ScoreboardRow[] {
  return normalizeScoreboardRows(
    records.filter((record) => {
      if (record.kind !== 'run') return false;
      const run = record.data as unknown as ReportRunResult;
      return hasBenchmarkProjectContext(run.projectContext);
    }),
  ).slice(0, 12);
}

function buildSwarmRunsTable(rows: ScoreboardRow[]): string[] {
  return rows.map((row) =>
    `| ${escapeCell(row.instruction)} | ${escapeCell(row.status)} | ${formatTimestamp(row.startedAt)} | ${formatTimestamp(row.completedAt)} | ${formatDuration(row.durationMs)} | ${formatRss(row.peakRssKb)} | ${row.tokenTotal} | ${row.editCount} | ${escapeCell(row.errorSummary)} | ${formatTrace(row.traceUrl)} |`,
  );
}

function latestMeaningfulSwarmRow(rows: ScoreboardRow[]): ScoreboardRow | null {
  return rows.find((row) => row.errorSummary !== 'Run cancelled by user') ?? rows[0] ?? null;
}

function buildRebuildFinalGatesTable(records: ResultRecord[]): string[] {
  const rows = records
    .filter((record) => record.kind === 'snapshot')
    .map((record) => {
      const label = typeof record.data['label'] === 'string' ? record.data['label'] : '';
      if (label !== 'rebuild-final') return null;

      const typecheck =
        record.data['typecheck'] && typeof record.data['typecheck'] === 'object'
          ? record.data['typecheck'] as { status?: string; errors?: number }
          : null;
      const tests =
        record.data['tests'] && typeof record.data['tests'] === 'object'
          ? record.data['tests'] as { total?: number; passed?: number; failed?: number }
          : null;
      const build =
        record.data['build'] && typeof record.data['build'] === 'object'
          ? record.data['build'] as { status?: string; durationMs?: number }
          : null;

      const typecheckStatus = typecheck?.status === 'pass' ? 'pass' : 'fail';
      const buildStatus = build?.status === 'pass' ? 'pass' : 'fail';
      const testFailed = tests?.failed ?? 0;
      const integrationStatus =
        typecheckStatus === 'pass' && buildStatus === 'pass' && testFailed === 0
          ? 'pass'
          : 'fail';

      return `| ${formatTimestamp(record.timestamp)} | ${integrationStatus} | ${typecheckStatus} | ${buildStatus} | ${tests?.passed ?? 0}/${tests?.total ?? 0} | ${typecheck?.errors ?? 0} | ${formatDuration(build?.durationMs ?? 0)} |`;
    })
    .filter((value): value is string => Boolean(value));

  return rows.slice(0, 8);
}

function latestRetryableWatchdogProof(records: ResultRecord[]): string | null {
  for (const record of records) {
    if (record.kind !== 'run') continue;
    const run = record.data as unknown as ReportRunResult;
    if (!hasBenchmarkProjectContext(run.projectContext)) continue;

    const assistantMessages = (run.messages ?? [])
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');

    if (!assistantMessages.includes('[Review] retry (executing): Execution issue (watchdog)')) {
      continue;
    }

    const advancedToVerification = Boolean(run.verificationResult);
    const outcome = advancedToVerification
      ? 'retryable watchdog recovered and advanced to verification'
      : 'retryable watchdog recovered inside executing';

    return `${outcome} at ${formatTimestamp(record.timestamp || run.savedAt || run.startedAt)} (${run.runId})`;
  }

  return null;
}

function summarizeLatestRebuildIntegration(records: ResultRecord[]): string | null {
  for (const record of records) {
    if (record.kind !== 'snapshot') continue;
    const label = typeof record.data['label'] === 'string' ? record.data['label'] : '';
    if (label !== 'rebuild-final') continue;

    const typecheck =
      record.data['typecheck'] && typeof record.data['typecheck'] === 'object'
        ? record.data['typecheck'] as { status?: string; errors?: number }
        : null;
    const tests =
      record.data['tests'] && typeof record.data['tests'] === 'object'
        ? record.data['tests'] as { total?: number; passed?: number; failed?: number }
        : null;
    const build =
      record.data['build'] && typeof record.data['build'] === 'object'
        ? record.data['build'] as { status?: string; durationMs?: number }
        : null;

    const typecheckStatus = typecheck?.status === 'pass' ? 'pass' : 'fail';
    const buildStatus = build?.status === 'pass' ? 'pass' : 'fail';
    const testFailed = tests?.failed ?? 0;
    const integrationStatus =
      typecheckStatus === 'pass' && buildStatus === 'pass' && testFailed === 0
        ? 'pass'
        : 'fail';

    return `${integrationStatus} (typecheck=${typecheckStatus}, build=${buildStatus}, tests=${tests?.passed ?? 0}/${tests?.total ?? 0})`;
  }

  return null;
}

export function renderBenchmarksReport(
  resultsDir: string | readonly string[] = resolveBenchmarkResultsDirs(),
  generatedAt: string = new Date().toISOString(),
): string {
  const records = readResultRecords(resultsDir);
  const rows = normalizeScoreboardRows(records);
  const bestRebuild = bestBenchByInstruction(rows);
  const latestRebuild = latestBenchByInstruction(rows);
  const integrationSummary = summarizeLatestRebuildIntegration(records);
  const swarmRows = latestSwarmRunRows(records);
  const latestMeaningfulSwarm = latestMeaningfulSwarmRow(swarmRows);
  const retryableWatchdogProof = latestRetryableWatchdogProof(records);
  const latestStepTimestamp = latestRebuildStepTimestamp(rows, latestBenchByInstruction);
  const bestStepTimestamp = latestRebuildStepTimestamp(rows, bestBenchByInstruction);
  const completed = REBUILD_INSTRUCTION_NAMES.filter((name) => bestRebuild.get(name)?.status === 'done').length;
  const totalTokens = REBUILD_INSTRUCTION_NAMES.reduce((sum, name) => sum + (bestRebuild.get(name)?.tokenTotal ?? 0), 0);
  const totalEdits = REBUILD_INSTRUCTION_NAMES.reduce((sum, name) => sum + (bestRebuild.get(name)?.editCount ?? 0), 0);
  const totalDurationMs = REBUILD_INSTRUCTION_NAMES.reduce((sum, name) => sum + (bestRebuild.get(name)?.durationMs ?? 0), 0);
  const finalGateRows = buildRebuildFinalGatesTable(records);

  return [
    '# Benchmarks',
    '',
    `Generated: ${formatTimestamp(generatedAt)}`,
    '',
    '## Rebuild Progress',
    '',
    '- Time zone: Texas (CT)',
    `- Best verified completion: ${completed}/${REBUILD_INSTRUCTION_NAMES.length} steps (${Math.round((completed / REBUILD_INSTRUCTION_NAMES.length) * 100)}%)`,
    `- Latest rebuild integration: ${integrationSummary ?? 'not captured (missing rebuild-final snapshot; step rows alone are not end-to-end proof)'}`,
    `- Best verified rebuild step evidence: ${bestStepTimestamp ? `persisted step-level run at ${formatTimestamp(bestStepTimestamp)}` : 'none'}`,
    `- Latest rebuild step evidence: ${latestStepTimestamp ? `persisted step-level run at ${formatTimestamp(latestStepTimestamp)}` : 'none'}`,
    `- Latest swarm attempt evidence: ${swarmRows[0] ? `${escapeCell(swarmRows[0].status)} at ${formatTimestamp(swarmRows[0].completedAt)} (${escapeCell(swarmRows[0].instruction)})` : 'none captured'}`,
    `- Latest non-cancelled swarm evidence: ${latestMeaningfulSwarm ? `${escapeCell(latestMeaningfulSwarm.status)} at ${formatTimestamp(latestMeaningfulSwarm.completedAt)} (${escapeCell(latestMeaningfulSwarm.instruction)})` : 'none captured'}`,
    `- Latest retryable-watchdog proof: ${retryableWatchdogProof ?? 'none captured'}`,
    `- Best verified rebuild-token total: ${totalTokens}`,
    `- Best verified rebuild-edit total: ${totalEdits}`,
    `- Best verified rebuild-duration: ${formatDuration(totalDurationMs)}`,
    '- Evidence note: only a persisted `rebuild-final` snapshot proves integrated typecheck/build/test status.',
    '',
    '## Best Verified Rebuild Steps',
    '',
    '| Instruction | Status | Started | Completed | Duration | Peak RSS | Tokens | Edits | Errors | Trace |',
    '|---|---:|---|---|---:|---:|---:|---:|---|---|',
    ...buildRebuildTable(rows, bestBenchByInstruction),
    '',
    '## Latest Rebuild Attempts',
    '',
    '| Instruction | Status | Started | Completed | Duration | Peak RSS | Tokens | Edits | Errors | Trace |',
    '|---|---:|---|---|---:|---:|---:|---:|---|---|',
    ...buildRebuildTable(rows, latestBenchByInstruction),
    '',
    '## Latest Swarm Attempts',
    '',
    swarmRows.length > 0
      ? '| Instruction | Status | Started | Completed | Duration | Peak RSS | Tokens | Edits | Errors | Trace |'
      : '_No persisted swarm campaign runs detected._',
    ...(swarmRows.length > 0 ? ['|---|---:|---|---|---:|---:|---:|---:|---|---|', ...buildSwarmRunsTable(swarmRows)] : []),
    '',
    '## Rebuild Final Gates',
    '',
    finalGateRows.length > 0
      ? '| Captured | Status | Typecheck | Build | Tests | Type Errors | Build Duration |'
      : '_No persisted rebuild-final snapshots detected._',
    ...(finalGateRows.length > 0 ? ['|---|---:|---:|---:|---:|---:|---:|', ...finalGateRows] : []),
    '',
    '## Recent Result Files',
    '',
    '_Includes benchmark runs plus persisted agent runs. Older run files may not have an instruction field._',
    '',
    '| Kind | Instruction | Status | Started | Completed | Duration | Peak RSS | Tokens | Edits | Errors | Trace |',
    '|---|---|---:|---|---|---:|---:|---:|---:|---|---|',
    ...buildRecentRunsTable(rows),
    '',
  ].join('\n');
}
