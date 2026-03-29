#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveBenchmarkResultsDirs } from '../src/reporting/benchmark-scope.js';
import { renderBenchmarksReport } from '../src/reporting/benchmarks-report.js';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const outPath = join(repoRoot, 'docs', 'benchmarks.md');

const markdown = renderBenchmarksReport(resolveBenchmarkResultsDirs());
writeFileSync(outPath, `${markdown}\n`);
console.log(`Wrote ${outPath}`);
