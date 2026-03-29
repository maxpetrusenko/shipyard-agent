import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readIssueSeed, type SeedIssue } from './issues-report.js';
import {
  summarizeInstruction,
  summarizeRunError,
  type ReportRunResult,
} from './result-files.js';

export const ISSUE_STATUS_VALUES = ['fixed', 'open', 'workaround'] as const;
export const PATCH_STATUS_VALUES = ['patched', 'open', 'workaround'] as const;
export const TEST_STATUS_VALUES = ['verified', 'pending', 'triage'] as const;
export const BENCHMARK_STATUS_VALUES = ['verified', 'pending', 'triage'] as const;

export type IssueStatus = (typeof ISSUE_STATUS_VALUES)[number];
export type PatchStatus = (typeof PATCH_STATUS_VALUES)[number];
export type TestStatus = (typeof TEST_STATUS_VALUES)[number];
export type BenchmarkStatus = (typeof BENCHMARK_STATUS_VALUES)[number];

export interface IssueTruthUpdateParams {
  seedPath: string;
  resultsDir: string;
  issueId: string;
  runId: string;
  createIfMissing?: boolean;
  symptom?: string;
  rootCause?: string;
  addressed?: string;
  status?: IssueStatus;
  patchStatus?: PatchStatus;
  testStatus?: TestStatus;
  benchmarkStatus?: BenchmarkStatus;
}

export interface IssueTruthUpdateResult {
  created: boolean;
  issue: SeedIssue;
  run: ReportRunResult;
}

function readRunResult(resultsDir: string, runId: string): ReportRunResult {
  const path = join(resultsDir, `${runId}.json`);
  if (!existsSync(path)) {
    throw new Error(`Run result not found: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ReportRunResult;
  if (parsed.runId !== runId) {
    throw new Error(`Run id mismatch in ${path}: expected ${runId}, got ${parsed.runId ?? 'unknown'}`);
  }
  return parsed;
}

function buildDefaultIssue(
  params: IssueTruthUpdateParams,
  run: ReportRunResult,
): SeedIssue {
  const summarizedError = summarizeRunError(run);
  const fallbackSymptom =
    summarizedError !== 'none'
      ? summarizedError
      : `Run evidence for ${summarizeInstruction(run.instruction ?? run.runId, 80)}`;
  return {
    id: params.issueId,
    symptom: params.symptom?.trim() || fallbackSymptom,
    rootCause:
      params.rootCause?.trim() || 'Triage pending from persisted run data.',
    addressed: params.addressed?.trim(),
    status: params.status ?? 'open',
    patchStatus: params.patchStatus ?? 'open',
    testStatus: params.testStatus ?? 'triage',
    benchmarkStatus: params.benchmarkStatus ?? 'triage',
    runs: [],
  };
}

function writeSeed(seedPath: string, issues: SeedIssue[]): void {
  writeFileSync(seedPath, `${JSON.stringify(issues, null, 2)}\n`);
}

export function updateIssueSeedFromRun(
  params: IssueTruthUpdateParams,
): IssueTruthUpdateResult {
  const seed = readIssueSeed(params.seedPath);
  const run = readRunResult(params.resultsDir, params.runId);
  const issueIndex = seed.findIndex((item) => item.id === params.issueId);
  const created = issueIndex === -1;

  if (created && !params.createIfMissing) {
    throw new Error(
      `Issue id not found in seed: ${params.issueId}. Pass createIfMissing=true to add it.`,
    );
  }

  const issue = created
    ? buildDefaultIssue(params, run)
    : { ...seed[issueIndex]! };

  if (params.symptom?.trim()) issue.symptom = params.symptom.trim();
  if (params.rootCause?.trim()) issue.rootCause = params.rootCause.trim();
  if (params.addressed !== undefined) {
    const addressed = params.addressed.trim();
    issue.addressed = addressed || undefined;
  }
  if (params.status) issue.status = params.status;
  if (params.patchStatus) issue.patchStatus = params.patchStatus;
  if (params.testStatus) issue.testStatus = params.testStatus;
  if (params.benchmarkStatus) issue.benchmarkStatus = params.benchmarkStatus;

  const existingRun = issue.runs.find((entry) => entry.id === params.runId);
  if (existingRun) {
    existingRun.traceUrl = run.traceUrl ?? existingRun.traceUrl ?? null;
  } else {
    issue.runs = [
      ...issue.runs,
      {
        id: params.runId,
        traceUrl: run.traceUrl ?? null,
      },
    ];
  }

  const nextSeed = created
    ? [...seed, issue]
    : seed.map((item, index) => (index === issueIndex ? issue : item));
  writeSeed(params.seedPath, nextSeed);

  return {
    created,
    issue,
    run,
  };
}
