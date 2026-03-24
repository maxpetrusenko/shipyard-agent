/**
 * Benchmark data API.
 *
 * Reads results/*.json, normalizes metrics to 0-100 scores,
 * and returns structured comparison data for the /benchmarks page.
 */

import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const RESULTS_DIR = resolve(process.env['SHIPYARD_RESULTS_DIR'] ?? join(process.cwd(), 'results'));

function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) result.catch(next);
    } catch (err) { next(err); }
  };
}

// ---------------------------------------------------------------------------
// Result file types
// ---------------------------------------------------------------------------

interface BaselineResult {
  timestamp: string;
  typecheck: string;
  tests: { total: number; passed: number; failed?: number };
  packages?: Record<string, string>;
}

interface SnapshotResult {
  type: 'snapshot';
  label: string;
  timestamp: string;
  path: string;
  typecheck: { status: string; errors: number };
  tests: { total: number; passed: number; failed: number };
  security: { vulnerabilities: number };
  loc: number;
  files: number;
  buildDurationMs?: number;
}

interface RunResult {
  runId: string;
  phase: string;
  durationMs: number;
  tokenUsage?: { input: number; output: number } | null;
  fileEdits?: Array<{ tier?: number; old_string?: string; new_string?: string }>;
  steps?: Array<{ status: string }>;
  verificationResult?: { passed: boolean; error_count: number } | null;
  savedAt?: string;
  error?: string | null;
}

interface BenchResult {
  benchId: string;
  instruction: string;
  durationMs: number;
  phase: string;
  tokenUsage: { input: number; output: number };
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  typecheck: { before: string; after: string; errorDelta: number };
  tests: { before: { total: number; passed: number }; after: { total: number; passed: number; failed: number } };
  buildSize?: string;
  securityAudit?: { vulnerabilities: number };
  editTiers?: { tier1: number; tier2: number; tier3: number; tier4: number };
  estimatedCost?: string;
  startedAt?: string;
}

// ---------------------------------------------------------------------------
// Score normalization (0-100, higher = better)
// ---------------------------------------------------------------------------

export interface CriterionScore {
  label: string;
  key: string;
  score: number;
  raw: string;
}

function scoreTypeSafety(typecheck: string, errors: number): CriterionScore {
  const score = typecheck === 'pass' ? Math.max(0, 100 - errors * 5) : Math.max(0, 50 - errors * 2);
  return { label: 'Type Safety', key: 'typeSafety', score, raw: `${typecheck} (${errors} errors)` };
}

function scoreTestHealth(passed: number, total: number): CriterionScore {
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;
  return { label: 'Test Health', key: 'testHealth', score, raw: `${passed}/${total}` };
}

function scoreSecurity(vulns: number): CriterionScore {
  const score = Math.max(0, 100 - vulns * 10);
  return { label: 'Security', key: 'security', score, raw: `${vulns} vulnerabilities` };
}

function scoreRunSpeed(durationMs: number, maxMs = 600_000): CriterionScore {
  const score = Math.max(0, Math.round((1 - Math.min(durationMs, maxMs) / maxMs) * 100));
  const secs = Math.round(durationMs / 1000);
  return { label: 'Run Speed', key: 'runSpeed', score, raw: `${secs}s` };
}

function scoreBuildSpeed(durationMs: number, maxMs = 60_000): CriterionScore {
  const score = durationMs > 0
    ? Math.max(0, Math.round((1 - Math.min(durationMs, maxMs) / maxMs) * 100))
    : 50;
  return { label: 'Build Speed', key: 'buildSpeed', score, raw: durationMs > 0 ? `${Math.round(durationMs / 1000)}s` : 'N/A' };
}

function scoreTokenEfficiency(tokens: number, linesChanged: number): CriterionScore {
  if (linesChanged <= 0) return { label: 'Token Efficiency', key: 'tokenEfficiency', score: 50, raw: 'N/A' };
  const tokensPerLine = tokens / linesChanged;
  const score = Math.max(0, Math.round(100 - Math.min(tokensPerLine / 100, 1) * 100));
  return { label: 'Token Efficiency', key: 'tokenEfficiency', score, raw: `${Math.round(tokensPerLine)} tok/line` };
}

function scoreEditQuality(tiers: { tier1: number; tier2: number; tier3: number; tier4: number }): CriterionScore {
  const total = tiers.tier1 + tiers.tier2 + tiers.tier3 + tiers.tier4;
  if (total === 0) return { label: 'Edit Quality', key: 'editQuality', score: 50, raw: 'no edits' };
  const goodPct = Math.round(((tiers.tier1 + tiers.tier2) / total) * 100);
  return { label: 'Edit Quality', key: 'editQuality', score: goodPct, raw: `${goodPct}% tier 1+2` };
}

function scoreCodeVolume(loc: number, baselineLoc: number): CriterionScore {
  if (baselineLoc <= 0) return { label: 'Code Volume', key: 'codeVolume', score: 50, raw: `${loc} LOC` };
  const ratio = Math.min(loc / baselineLoc, 2);
  const score = Math.round(ratio * 50);
  return { label: 'Code Volume', key: 'codeVolume', score, raw: `${loc} LOC` };
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

function readJsonSafe<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch { return null; }
}

function listResultFiles(): string[] {
  try {
    return readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json')).sort();
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Aggregate data builder
// ---------------------------------------------------------------------------

export interface BenchmarkData {
  baseline: { label: string; scores: CriterionScore[] } | null;
  snapshots: Array<{ label: string; timestamp: string; scores: CriterionScore[] }>;
  runs: Array<{
    runId: string;
    savedAt: string;
    durationMs: number;
    scores: CriterionScore[];
  }>;
  criteria: string[];
}

function buildBenchmarkData(): BenchmarkData {
  const files = listResultFiles();
  const baseline = readJsonSafe<BaselineResult>(join(RESULTS_DIR, 'baseline.json'));
  const comparison = readJsonSafe<Record<string, unknown>>(join(RESULTS_DIR, 'comparison.json'));

  const baselineLoc = (comparison as { original?: { loc?: number } })?.original?.loc ?? 0;

  const baselineScores: CriterionScore[] | null = baseline ? [
    scoreTypeSafety(baseline.typecheck, 0),
    scoreTestHealth(baseline.tests.passed, baseline.tests.total),
    scoreSecurity(0),
    scoreRunSpeed(0, 600_000),
    scoreBuildSpeed(0),
    scoreTokenEfficiency(0, 0),
    scoreEditQuality({ tier1: 0, tier2: 0, tier3: 0, tier4: 0 }),
    scoreCodeVolume(baselineLoc, baselineLoc),
  ] : null;

  const snapshots: BenchmarkData['snapshots'] = [];
  const runs: BenchmarkData['runs'] = [];

  for (const fname of files) {
    if (fname === 'baseline.json' || fname === 'comparison.json') continue;
    const fpath = join(RESULTS_DIR, fname);
    const raw = readJsonSafe<Record<string, unknown>>(fpath);
    if (!raw) continue;

    if ((raw as { type?: string }).type === 'snapshot') {
      const snap = raw as unknown as SnapshotResult;
      snapshots.push({
        label: snap.label,
        timestamp: snap.timestamp,
        scores: [
          scoreTypeSafety(snap.typecheck.status, snap.typecheck.errors),
          scoreTestHealth(snap.tests.passed, snap.tests.total),
          scoreSecurity(snap.security.vulnerabilities),
          scoreRunSpeed(0, 600_000),
          scoreBuildSpeed(snap.buildDurationMs ?? 0),
          scoreTokenEfficiency(0, 0),
          scoreEditQuality({ tier1: 0, tier2: 0, tier3: 0, tier4: 0 }),
          scoreCodeVolume(snap.loc, baselineLoc),
        ],
      });
      continue;
    }

    if ('benchId' in raw) {
      const bench = raw as unknown as BenchResult;
      const totalTokens = (bench.tokenUsage?.input ?? 0) + (bench.tokenUsage?.output ?? 0);
      const linesChanged = (bench.linesAdded ?? 0) + (bench.linesRemoved ?? 0);
      runs.push({
        runId: bench.benchId,
        savedAt: bench.startedAt ?? '',
        durationMs: bench.durationMs,
        scores: [
          scoreTypeSafety(bench.typecheck?.after ?? 'unknown', bench.typecheck?.errorDelta ?? 0),
          scoreTestHealth(bench.tests?.after?.passed ?? 0, bench.tests?.after?.total ?? 0),
          scoreSecurity(bench.securityAudit?.vulnerabilities ?? 0),
          scoreRunSpeed(bench.durationMs),
          scoreBuildSpeed(0),
          scoreTokenEfficiency(totalTokens, linesChanged),
          scoreEditQuality(bench.editTiers ?? { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }),
          scoreCodeVolume(bench.linesAdded ?? 0, baselineLoc),
        ],
      });
      continue;
    }

    if ('runId' in raw) {
      const run = raw as unknown as RunResult;
      if (!run.durationMs || run.durationMs < 1000) continue;
      const tok = run.tokenUsage ?? { input: 0, output: 0 };
      if ((tok.input ?? 0) < 100) continue;

      const edits = run.fileEdits ?? [];
      const tiers = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
      let linesChanged = 0;
      for (const e of edits) {
        const t = (e.tier ?? 4) as 1 | 2 | 3 | 4;
        if (t === 1) tiers.tier1++;
        else if (t === 2) tiers.tier2++;
        else if (t === 3) tiers.tier3++;
        else tiers.tier4++;
        const oldLines = (e.old_string ?? '').split('\n').length;
        const newLines = (e.new_string ?? '').split('\n').length;
        linesChanged += Math.max(oldLines, newLines);
      }

      const totalTokens = (tok.input ?? 0) + (tok.output ?? 0);
      const vr = run.verificationResult;

      runs.push({
        runId: run.runId,
        savedAt: run.savedAt ?? '',
        durationMs: run.durationMs,
        scores: [
          scoreTypeSafety(vr ? (vr.passed ? 'pass' : 'fail') : 'unknown', vr?.error_count ?? 0),
          scoreTestHealth(
            vr?.passed ? (run.steps?.filter(s => s.status === 'done').length ?? 0) : 0,
            run.steps?.length ?? 1,
          ),
          scoreSecurity(0),
          scoreRunSpeed(run.durationMs),
          scoreBuildSpeed(0),
          scoreTokenEfficiency(totalTokens, linesChanged),
          scoreEditQuality(tiers),
          scoreCodeVolume(linesChanged, baselineLoc),
        ],
      });
    }
  }

  runs.sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || ''));

  return {
    baseline: baselineScores ? { label: 'Original Ship', scores: baselineScores } : null,
    snapshots,
    runs,
    criteria: ['typeSafety', 'testHealth', 'security', 'runSpeed', 'buildSpeed', 'tokenEfficiency', 'editQuality', 'codeVolume'],
  };
}

// ---------------------------------------------------------------------------
// Snapshot capture
// ---------------------------------------------------------------------------

function captureSnapshot(targetDir: string, label: string): SnapshotResult {
  const timestamp = new Date().toISOString();

  let tcStatus = 'pass';
  let tcErrors = 0;
  try {
    execSync('pnpm type-check 2>&1', { cwd: targetDir, timeout: 120_000, encoding: 'utf-8' });
  } catch (e) {
    tcStatus = 'fail';
    const output = (e as { stdout?: string }).stdout ?? '';
    tcErrors = (output.match(/error TS/g) ?? []).length;
  }

  let testTotal = 0;
  let testPassed = 0;
  let testFailed = 0;
  try {
    const testOut = execSync('pnpm test 2>&1', { cwd: targetDir, timeout: 300_000, encoding: 'utf-8' });
    const totalMatch = testOut.match(/Tests\s+(\d+)/);
    const passedMatch = testOut.match(/(\d+)\s+passed/);
    testTotal = totalMatch?.[1] ? parseInt(totalMatch[1], 10) : 0;
    testPassed = passedMatch?.[1] ? parseInt(passedMatch[1], 10) : 0;
  } catch (e) {
    const output = (e as { stdout?: string }).stdout ?? '';
    const totalMatch = output.match(/Tests\s+(\d+)/);
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    testTotal = totalMatch?.[1] ? parseInt(totalMatch[1], 10) : 0;
    testPassed = passedMatch?.[1] ? parseInt(passedMatch[1], 10) : 0;
    testFailed = failedMatch?.[1] ? parseInt(failedMatch[1], 10) : 0;
  }

  let vulns = 0;
  try {
    const auditOut = execSync('pnpm audit --json 2>/dev/null || echo "{}"', { cwd: targetDir, timeout: 30_000, encoding: 'utf-8' });
    const auditData = JSON.parse(auditOut) as { metadata?: { vulnerabilities?: { total?: number } } };
    vulns = auditData?.metadata?.vulnerabilities?.total ?? 0;
  } catch { /* audit unavailable */ }

  let loc = 0;
  let fileCount = 0;
  try {
    const wcOut = execSync("find . -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' | grep -v node_modules | grep -v dist | wc -l", { cwd: targetDir, encoding: 'utf-8' });
    fileCount = parseInt(wcOut.trim(), 10) || 0;
    const locOut = execSync("find . -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' | grep -v node_modules | grep -v dist | xargs wc -l 2>/dev/null | tail -1", { cwd: targetDir, encoding: 'utf-8' });
    const locMatch = locOut.match(/(\d+)/);
    loc = locMatch?.[1] ? parseInt(locMatch[1], 10) : 0;
  } catch { /* count failed */ }

  let buildDurationMs = 0;
  try {
    const buildStart = Date.now();
    execSync('pnpm build 2>&1', { cwd: targetDir, timeout: 120_000, encoding: 'utf-8' });
    buildDurationMs = Date.now() - buildStart;
  } catch { /* build failed or not available */ }

  const snapshot: SnapshotResult = {
    type: 'snapshot',
    label,
    timestamp,
    path: targetDir,
    typecheck: { status: tcStatus, errors: tcErrors },
    tests: { total: testTotal, passed: testPassed, failed: testFailed },
    security: { vulnerabilities: vulns },
    loc,
    files: fileCount,
    buildDurationMs,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const fname = `snapshot-${label}-${timestamp.replace(/[:.]/g, '')}.json`;
  writeFileSync(join(RESULTS_DIR, fname), JSON.stringify(snapshot, null, 2));

  return snapshot;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createBenchmarkRoutes(): Router {
  const router = Router();
  router.use(json({ limit: '1mb' }));

  router.get('/benchmarks', wrap((_req, res) => {
    const data = buildBenchmarkData();
    res.json(data);
  }));

  router.post('/benchmarks/snapshot', wrap((req, res) => {
    const { targetDir, label } = req.body as { targetDir?: string; label?: string };
    if (!targetDir || !label) {
      res.status(400).json({ error: 'targetDir and label are required' });
      return;
    }
    const snapshot = captureSnapshot(targetDir, label);
    res.json(snapshot);
  }));

  return router;
}
