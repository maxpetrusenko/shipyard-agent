#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderIssuesReport } from '../src/reporting/issues-report.js';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const resultsDir = process.env['SHIPYARD_RESULTS_DIR']?.trim() || join(repoRoot, 'results');
const seedPath = join(repoRoot, 'docs', 'issues.seed.json');
const outPath = join(repoRoot, 'docs', 'issues.md');

const markdown = renderIssuesReport(resultsDir, seedPath);
writeFileSync(outPath, `${markdown}\n`);
console.log(`Wrote ${outPath}`);
