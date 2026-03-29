#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderBenchmarksReport } from '../src/reporting/benchmarks-report.js';
import { resolveBenchmarkResultsDirs } from '../src/reporting/benchmark-scope.js';
import { renderIssuesReport } from '../src/reporting/issues-report.js';
import {
  BENCHMARK_STATUS_VALUES,
  ISSUE_STATUS_VALUES,
  PATCH_STATUS_VALUES,
  TEST_STATUS_VALUES,
  updateIssueSeedFromRun,
  type BenchmarkStatus,
  type IssueStatus,
  type PatchStatus,
  type TestStatus,
} from '../src/reporting/issue-truth.js';
import { summarizeInstruction, summarizeRunError } from '../src/reporting/result-files.js';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

interface CliArgs {
  issueId: string;
  runId: string;
  createIfMissing: boolean;
  seedPath: string;
  resultsDir: string;
  symptom?: string;
  rootCause?: string;
  addressed?: string;
  status?: IssueStatus;
  patchStatus?: PatchStatus;
  testStatus?: TestStatus;
  benchmarkStatus?: BenchmarkStatus;
  renderDocs: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  pnpm exec tsx scripts/update-run-truth.ts --issue <issue-id> --run <run-id> [options]',
    '',
    'Options:',
    '  --create                     Create the issue if missing in docs/issues.seed.json',
    '  --seed <path>                Override seed path (default: docs/issues.seed.json)',
    '  --results-dir <path>         Override results dir (default: results)',
    `  --status <${ISSUE_STATUS_VALUES.join('|')}>`,
    `  --patch-status <${PATCH_STATUS_VALUES.join('|')}>`,
    `  --test-status <${TEST_STATUS_VALUES.join('|')}>`,
    `  --benchmark-status <${BENCHMARK_STATUS_VALUES.join('|')}>`,
    '  --symptom <text>             Replace symptom text',
    '  --root-cause <text>          Replace root cause text',
    '  --addressed <text>           Replace addressed/notes text',
    '  --no-render                  Skip docs/issues.md + docs/benchmarks.md rerender',
    '  --help                       Show this help',
    '',
    'Example:',
    '  ./scripts/update-run-truth.sh --issue bare-step-complete-late-step-drift --run 743fb053-da31-4229-a59d-268485d8cd5d --status fixed --patch-status patched --test-status verified --benchmark-status verified',
  ].join('\n');
}

function expectValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseEnumValue<T extends readonly string[]>(
  value: string,
  allowed: T,
  flag: string,
): T[number] {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`Invalid ${flag}: ${value}. Expected one of ${allowed.join(', ')}`);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    issueId: '',
    runId: '',
    createIfMissing: false,
    seedPath: join(repoRoot, 'docs', 'issues.seed.json'),
    resultsDir: join(repoRoot, 'results'),
    renderDocs: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--issue':
        parsed.issueId = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--run':
        parsed.runId = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--create':
        parsed.createIfMissing = true;
        break;
      case '--seed':
        parsed.seedPath = resolve(expectValue(argv, index, arg));
        index += 1;
        break;
      case '--results-dir':
        parsed.resultsDir = resolve(expectValue(argv, index, arg));
        index += 1;
        break;
      case '--symptom':
        parsed.symptom = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--root-cause':
        parsed.rootCause = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--addressed':
        parsed.addressed = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--status':
        parsed.status = parseEnumValue(expectValue(argv, index, arg), ISSUE_STATUS_VALUES, arg);
        index += 1;
        break;
      case '--patch-status':
        parsed.patchStatus = parseEnumValue(expectValue(argv, index, arg), PATCH_STATUS_VALUES, arg);
        index += 1;
        break;
      case '--test-status':
        parsed.testStatus = parseEnumValue(expectValue(argv, index, arg), TEST_STATUS_VALUES, arg);
        index += 1;
        break;
      case '--benchmark-status':
        parsed.benchmarkStatus = parseEnumValue(expectValue(argv, index, arg), BENCHMARK_STATUS_VALUES, arg);
        index += 1;
        break;
      case '--no-render':
        parsed.renderDocs = false;
        break;
      case '--help':
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (!parsed.issueId.trim()) throw new Error('Missing required --issue');
  if (!parsed.runId.trim()) throw new Error('Missing required --run');
  return parsed;
}

function rerenderDocs(seedPath: string, resultsDir: string): void {
  const issuesPath = join(repoRoot, 'docs', 'issues.md');
  const benchmarksPath = join(repoRoot, 'docs', 'benchmarks.md');
  writeFileSync(issuesPath, `${renderIssuesReport(resultsDir, seedPath)}\n`);
  writeFileSync(benchmarksPath, `${renderBenchmarksReport(resolveBenchmarkResultsDirs())}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = updateIssueSeedFromRun({
    seedPath: args.seedPath,
    resultsDir: args.resultsDir,
    issueId: args.issueId,
    runId: args.runId,
    createIfMissing: args.createIfMissing,
    symptom: args.symptom,
    rootCause: args.rootCause,
    addressed: args.addressed,
    status: args.status,
    patchStatus: args.patchStatus,
    testStatus: args.testStatus,
    benchmarkStatus: args.benchmarkStatus,
  });

  if (args.renderDocs) {
    rerenderDocs(args.seedPath, args.resultsDir);
  }

  console.log(
    [
      `updated issue=${result.issue.id}`,
      `created=${result.created}`,
      `run=${result.run.runId}`,
      `phase=${result.run.phase}`,
      `error=${summarizeRunError(result.run)}`,
      `instruction=${summarizeInstruction(result.run.instruction ?? result.run.runId, 100)}`,
      `trace=${result.run.traceUrl ?? 'none'}`,
      `rendered=${args.renderDocs}`,
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('');
  console.error(usage());
  process.exit(1);
});
