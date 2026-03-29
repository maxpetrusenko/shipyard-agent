#!/usr/bin/env tsx
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface RebuildBenchRecord {
  benchId: string;
  instruction: string;
  phase: string;
  durationMs: number;
  peakRssKb: number | null;
  tokenUsage: { input: number; output: number };
  traceUrl: string | null;
  filesChanged: number;
  editToolCalls: number;
  error: string | null;
  startedAt: string;
  completedAt: string;
  source: 'rebuild-log';
}

function toDate(date: Date, time: string): Date {
  const [hours, minutes, seconds] = time.split(':').map((part) => Number.parseInt(part, 10));
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, 0);
}

function toIso(date: Date, time: string): string {
  return toDate(date, time).toISOString();
}

function elapsedMs(date: Date, startedAt: string, completedAt: string): number {
  const start = toDate(date, startedAt).getTime();
  const end = toDate(date, completedAt).getTime();
  return Math.max(0, end - start);
}

function sanitizeInstruction(name: string): string {
  return name.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const logPath = process.argv[2];
const resultsDir = process.argv[3] ? resolve(process.argv[3]) : join(repoRoot, 'results');

if (!logPath) {
  console.error('Usage: pnpm tsx scripts/import-rebuild-log.ts <log-path> [results-dir]');
  process.exit(1);
}

const logText = readFileSync(logPath, 'utf8');
const logDate = statSync(logPath).mtime;
const dateTag = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}-${String(logDate.getDate()).padStart(2, '0')}`;
const lines = logText.split(/\r?\n/);
const submitTimes = new Map<string, string>();
const records = new Map<string, RebuildBenchRecord>();
let pendingTraceFor: string | null = null;

for (const line of lines) {
  const submitMatch = line.match(/^(\d{2}:\d{2}:\d{2}) \[SUBMIT\] ([^ ]+)/);
  if (submitMatch) {
    submitTimes.set(submitMatch[2], submitMatch[1]);
    continue;
  }

  const doneMatch = line.match(/^(\d{2}:\d{2}:\d{2}) \[DONE\] ([^:]+): phase=([^ ]+) duration=(\d+)ms tokens=(\d+) steps=(\d+) edits=(\d+)(?: edit_tools=(\d+))? tools=(\d+)(?: rss_kb=(\d+))?/);
  if (doneMatch) {
    const [, completedTime, instruction, phase, _reportedDurationMsRaw, tokenTotalRaw, , editsRaw, editToolCallsRaw, , peakRssKbRaw] = doneMatch;
    const startedTime = submitTimes.get(instruction) ?? completedTime;
    records.set(instruction, {
      benchId: `rebuild-${dateTag}-${sanitizeInstruction(instruction)}`,
      instruction,
      phase,
      durationMs: elapsedMs(logDate, startedTime, completedTime),
      peakRssKb: peakRssKbRaw ? Number.parseInt(peakRssKbRaw, 10) : null,
      tokenUsage: { input: 0, output: Number.parseInt(tokenTotalRaw, 10) },
      traceUrl: null,
      filesChanged: Number.parseInt(editsRaw, 10),
      editToolCalls: Number.parseInt(editToolCallsRaw ?? editsRaw, 10),
      error: phase === 'done' ? null : `phase=${phase}`,
      startedAt: toIso(logDate, startedTime),
      completedAt: toIso(logDate, completedTime),
      source: 'rebuild-log',
    });
    pendingTraceFor = instruction;
    continue;
  }

  const traceMatch = line.match(/^\s*trace:\s*(https?:\/\/\S+)/);
  if (traceMatch && pendingTraceFor) {
    const record = records.get(pendingTraceFor);
    if (record) record.traceUrl = traceMatch[1];
    pendingTraceFor = null;
  }
}

if (records.size === 0) {
  console.error(`No [DONE] lines found in ${logPath}`);
  process.exit(1);
}

mkdirSync(resultsDir, { recursive: true });
for (const record of records.values()) {
  const outPath = join(resultsDir, `${record.benchId}.json`);
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
}
