/**
 * Deterministic guardrails for scope/completeness checks.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FileEdit, PlanStep, ShipyardStateType } from './state.js';

export interface ScopeConstraints {
  strictSingleFile: boolean;
  disallowUnrelatedFiles: boolean;
  explicitFiles: string[];
}

export interface ScopeGuardResult {
  ok: boolean;
  reason: string | null;
}

export function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

function looksLikePathToken(token: string): boolean {
  if (!token.includes('/')) return false;
  if (token.startsWith('http://') || token.startsWith('https://')) return false;
  // Reject extension lists like ".exe/.bat/.sh/.dll" where every segment starts with "."
  const segments = token.split('/').filter(Boolean);
  if (segments.length > 0 && segments.every((s) => s.startsWith('.'))) return false;
  return /\.[a-zA-Z0-9]{1,8}$/.test(token);
}

function parseExplicitFiles(instruction: string): string[] {
  const seen = new Set<string>();
  const regex = /(?:^|\s)(\/?[A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,8})(?=$|\s|[.,;:()])/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(instruction)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    if (!looksLikePathToken(raw)) continue;
    seen.add(normalizePath(raw));
  }
  return [...seen];
}

function anyInstructionMatch(instruction: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(instruction));
}

export function deriveScopeConstraints(instruction: string): ScopeConstraints {
  const text = instruction.toLowerCase();
  const explicitFiles = parseExplicitFiles(instruction);
  const strictSingleFile = explicitFiles.length === 1 || anyInstructionMatch(text, [
    /\bexactly one (existing )?file\b/,
    /\bone file only\b/,
    /\bsingle file\b/,
    /\bone untouched file\b/,
    /\bkeep to one file\b/,
    /\bjust one file\b/,
    /\bdo not touch more than (?:1|one) file\b/,
  ]);
  const disallowUnrelatedFiles = strictSingleFile || explicitFiles.length > 0 || anyInstructionMatch(text, [
    /\bdo not (edit|modify|change) any other file\b/,
    /\bdon'?t (edit|modify|change) unrelated files\b/,
    /\bdon'?t modify unrelated files\b/,
    /\bno unrelated files\b/,
    /\bexact file only\b/,
  ]);
  return {
    strictSingleFile,
    disallowUnrelatedFiles,
    explicitFiles,
  };
}

export function uniqueEditedPaths(fileEdits: FileEdit[]): string[] {
  return [...new Set(fileEdits.map((e) => normalizePath(e.file_path)).filter(Boolean))];
}

function equivalentScopePaths(rawPath: string): string[] {
  const normalized = normalizePath(rawPath);
  const variants = new Set<string>([normalized]);
  const replacements: Array<[string, string]> = [
    ['/api/src/db/', '/api/db/'],
    ['/api/db/', '/api/src/db/'],
    ['/src/db/', '/db/'],
    ['/db/', '/src/db/'],
  ];
  for (const [from, to] of replacements) {
    if (normalized.includes(from)) {
      variants.add(normalized.replace(from, to));
    }
  }
  return [...variants];
}

export function pathMatchesAny(filePath: string, candidates: string[]): boolean {
  const fileVariants = equivalentScopePaths(filePath);
  return candidates.some((raw) => {
    const candidateVariants = equivalentScopePaths(raw);
    return fileVariants.some((fp) =>
      candidateVariants.some((cand) =>
        fp === cand || fp.endsWith(`/${cand}`) || cand.endsWith(`/${fp}`),
      ),
    );
  });
}

function uniquePlannedPaths(steps: PlanStep[]): string[] {
  return [...new Set(steps.flatMap((s) => s.files).map(normalizePath).filter(Boolean))];
}

export function evaluateScopeGuard(
  state: Pick<ShipyardStateType, 'instruction' | 'steps' | 'fileEdits'>,
): ScopeGuardResult {
  const constraints = deriveScopeConstraints(state.instruction);
  const edited = uniqueEditedPaths(state.fileEdits);
  if (!constraints.strictSingleFile && !constraints.disallowUnrelatedFiles && constraints.explicitFiles.length === 0) {
    return { ok: true, reason: null };
  }

  if (
    constraints.strictSingleFile &&
    edited.length !== 1 &&
    !(constraints.explicitFiles.length === 1 && edited.length === 0)
  ) {
    return {
      ok: false,
      reason: `Instruction requested exactly one file change, but ${edited.length} file(s) were edited.`,
    };
  }

  if (constraints.explicitFiles.length > 0) {
    const outside = edited.filter((p) => !pathMatchesAny(p, constraints.explicitFiles));
    if (outside.length > 0) {
      return {
        ok: false,
        reason: `Edited files outside explicit targets: ${outside.join(', ')}`,
      };
    }
  }

  if (constraints.disallowUnrelatedFiles) {
    const planned = uniquePlannedPaths(state.steps);
    // Merge explicit instruction files into the allowed set — if the instruction
    // names a file it's always in-scope even if the planner omitted it from steps.
    const allowed = [...planned, ...constraints.explicitFiles];
    if (allowed.length > 0) {
      const outsidePlan = edited.filter((p) => !pathMatchesAny(p, allowed));
      if (outsidePlan.length > 0) {
        return {
          ok: false,
          reason: `Edited files outside planned scope: ${outsidePlan.join(', ')}`,
        };
      }
    }
  }

  return { ok: true, reason: null };
}

// Truly read-only prefixes — "document" and "review" are ambiguous (can imply edits) so excluded
const INFORMATIONAL_PREFIXES = [
  /^\s*(explain|describe|how\s+do\s+i|what\s+is|what\s+are|list\s|show\s|tell\s+me|summarize|outline|overview|analyze)\b/i,
];

const EDIT_INTENT_PATTERNS = [
  /\b(make|apply|add|update|change|edit|modify|fix|refactor|implement|create|write|remove|delete|replace|rename|move|insert|patch|document|build|rebuild|bootstrap|scaffold|generate)\b/,
  /\bbugfix\b/,
  /\bplease\b.*\b(make|apply|add|update|change|edit|modify|fix|refactor|implement)\b/,
];

export function shouldRequireEdits(instruction: string): boolean {
  const text = instruction.toLowerCase();
  const hasEditIntent = anyInstructionMatch(text, EDIT_INTENT_PATTERNS);
  if (!hasEditIntent) return false;
  // Informational prefix bypasses unless there's also explicit file path or edit verb
  const isInformational = INFORMATIONAL_PREFIXES.some((p) => p.test(text));
  if (isInformational) {
    // File path in instruction → almost certainly an edit task
    if (parseExplicitFiles(text).length > 0) return true;
    // Conjunctive edit verb alongside informational prefix
    return anyInstructionMatch(text, [
      /\b(?:and|then|also)\s+(?:make|apply|add|update|change|edit|modify|fix|refactor|implement)\b/,
    ]);
  }
  return true;
}

const APP_BOOTSTRAP_PATTERNS = [
  /\b(?:build|rebuild|bootstrap|scaffold|create|generate|start)\b[\s\S]{0,80}\b(?:app|site|ui|frontend|dashboard|web app|landing page|project)\b/i,
  /\bship app\b/i,
];

const COMMON_APP_MANIFESTS = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Package.swift',
];

const COMMON_UI_SURFACES = [
  'index.html',
  'src/App.tsx',
  'src/App.jsx',
  'src/App.ts',
  'src/App.js',
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'app/page.tsx',
  'app/page.jsx',
  'app/page.ts',
  'app/page.js',
  'pages/index.tsx',
  'pages/index.jsx',
  'pages/index.ts',
  'pages/index.js',
  'public/index.html',
];

export interface BootstrapWorkspaceStatus {
  required: boolean;
  ready: boolean;
  manifestPath: string | null;
  uiSurfacePath: string | null;
  installEvidencePath: string | null;
  missing: string[];
}

function fileExists(pathValue: string): boolean {
  try {
    return existsSync(pathValue) && statSync(pathValue).isFile();
  } catch {
    return false;
  }
}

function dirExists(pathValue: string): boolean {
  try {
    return existsSync(pathValue) && statSync(pathValue).isDirectory();
  } catch {
    return false;
  }
}

function firstExistingPath(workDir: string, relativePaths: string[], kind: 'file' | 'dir'): string | null {
  for (const relativePath of relativePaths) {
    const candidate = join(workDir, relativePath);
    if (kind === 'file' ? fileExists(candidate) : dirExists(candidate)) return candidate;
  }
  return null;
}

function readPackageJson(workDir: string): {
  scripts: string[];
  hasDependencies: boolean;
} | null {
  const packageJsonPath = join(workDir, 'package.json');
  if (!fileExists(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return {
      scripts: Object.keys(parsed.scripts ?? {}),
      hasDependencies:
        Object.keys(parsed.dependencies ?? {}).length > 0
        || Object.keys(parsed.devDependencies ?? {}).length > 0,
    };
  } catch {
    return { scripts: [], hasDependencies: false };
  }
}

export function requiresBootstrapWorkspace(instruction: string): boolean {
  if (!shouldRequireEdits(instruction)) return false;
  return APP_BOOTSTRAP_PATTERNS.some((pattern) => pattern.test(instruction));
}

export function inspectBootstrapWorkspace(
  instruction: string,
  workDir: string,
): BootstrapWorkspaceStatus {
  const required = requiresBootstrapWorkspace(instruction);
  if (!required) {
    return {
      required: false,
      ready: true,
      manifestPath: null,
      uiSurfacePath: null,
      installEvidencePath: null,
      missing: [],
    };
  }

  const manifestPath = firstExistingPath(workDir, COMMON_APP_MANIFESTS, 'file');
  const uiSurfacePath = firstExistingPath(workDir, COMMON_UI_SURFACES, 'file');
  const missing: string[] = [];

  if (!manifestPath) missing.push('package/app manifest');
  if (!uiSurfacePath) missing.push('UI entry surface');

  let installEvidencePath: string | null = null;
  const packageJson = readPackageJson(workDir);
  if (packageJson) {
    const hasRuntimeScript = ['dev', 'start', 'build'].some((script) => packageJson.scripts.includes(script));
    if (!hasRuntimeScript) missing.push('app run/build script');
    if (packageJson.hasDependencies) {
      installEvidencePath = firstExistingPath(workDir, ['node_modules'], 'dir');
      if (!installEvidencePath) missing.push('installed dependencies');
    }
  }

  return {
    required,
    ready: missing.length === 0,
    manifestPath,
    uiSurfacePath,
    installEvidencePath,
    missing,
  };
}

export function constrainPlanStepsToScope(
  instruction: string,
  steps: PlanStep[],
): PlanStep[] {
  const constraints = deriveScopeConstraints(instruction);
  if (constraints.explicitFiles.length === 0) return steps;

  const scoped = steps
    .map((step) => ({
      ...step,
      files: step.files.filter((file) => pathMatchesAny(file, constraints.explicitFiles)),
    }))
    .filter((step) => step.files.length > 0)
    .map((step, index) => ({ ...step, index }));

  if (scoped.length > 0) return scoped;

  return [{
    index: 0,
    description: instruction.trim() || steps[0]?.description || 'Apply requested change',
    files: [...constraints.explicitFiles],
    status: 'pending',
  }];
}

export function isDiscoveryToolName(toolName: string): boolean {
  return (
    toolName === 'read_file' ||
    toolName === 'grep' ||
    toolName === 'glob' ||
    toolName === 'ls' ||
    toolName === 'bash'
  );
}

export function deriveDiscoveryCallLimit(instruction: string): number | null {
  const explicit = instruction.match(
    /\bmax\s+(\d{1,3})\s+discovery tool calls?\s+before\s+first edit\b/i,
  );
  if (explicit) {
    const parsed = Number.parseInt(explicit[1] ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const constraints = deriveScopeConstraints(instruction);
  if (constraints.strictSingleFile) return 12;
  if (constraints.disallowUnrelatedFiles) return 18;
  return null;
}

export function deriveFirstEditDeadlineMs(instruction: string): number | null {
  const explicit = instruction.match(
    /\b(?:first[- ]edit deadline|max first[- ]edit wait|first edit deadline)\b[^0-9]{0,20}(\d{1,4})\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?)\b/i,
  );
  if (explicit) {
    const raw = Number.parseInt(explicit[1] ?? '', 10);
    const unit = (explicit[2] ?? '').toLowerCase();
    if (Number.isFinite(raw) && raw > 0) {
      if (unit.startsWith('ms')) return raw;
      if (unit === 's' || unit.startsWith('sec')) return raw * 1_000;
      if (unit === 'm' || unit.startsWith('min')) return raw * 60_000;
    }
  }
  const constraints = deriveScopeConstraints(instruction);
  if (constraints.strictSingleFile) return 120_000;
  if (constraints.disallowUnrelatedFiles) return 150_000;
  // Non-scoped edit instructions still get a generous deadline to prevent
  // infinite exploration loops (was null → no limit, which let runs stall).
  if (shouldRequireEdits(instruction)) return 180_000;
  return null;
}

const REPO_TARGET_STOPWORDS = new Set([
  'this',
  'that',
  'the',
  'a',
  'an',
  'repo',
  'repository',
  'project',
  'codebase',
  'one',
  'single',
]);

function basenamePath(value: string): string {
  const parts = normalizePath(value).split('/').filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function looksLikeRepoPathReference(value: string): boolean {
  const normalized = normalizePath(value);
  if (normalized.startsWith('/') || normalized.startsWith('~/')) return true;
  if (/^[A-Za-z]:\//.test(normalized)) return true;
  const slashCount = (normalized.match(/\//g) ?? []).length;
  return slashCount >= 2;
}

interface ExplicitRepoTarget {
  targetRepo: string;
  weakBareToken: boolean;
}

function extractExplicitRepoTargetDetails(instruction: string): ExplicitRepoTarget | null {
  const patterns = [
    {
      pattern: /^\s*in\s+((?:~\/|\/|[A-Za-z]:[\\/]|[A-Za-z0-9._-]+\/)[^\s,;]+)\s*(?:,|\n|$)/im,
      weakBareToken: false,
    },
    {
      pattern: /^\s*in\s+([a-zA-Z0-9._-]+)\s*(?:,|\n|$)/im,
      weakBareToken: true,
    },
    {
      pattern: /\b(?:in|inside|within)\s+((?:~\/|\/|[A-Za-z]:[\\/]|[A-Za-z0-9._-]+\/)[^\s,;]+)\b/i,
      weakBareToken: false,
    },
    {
      pattern: /\b(?:in|inside|within)\s+([a-zA-Z0-9._-]+)\s+(?:repo|repository|project|codebase)\b/i,
      weakBareToken: false,
    },
  ];
  for (const { pattern, weakBareToken } of patterns) {
    const m = instruction.match(pattern);
    const rawCandidate = m?.[1]?.trim();
    const candidate = rawCandidate?.replace(/[.,;:]+$/, '');
    if (!candidate) continue;
    if ((candidate.includes('/') || candidate.includes('\\')) && !looksLikeRepoPathReference(candidate)) {
      continue;
    }
    const normalizedCandidate = candidate.includes('/') || candidate.includes('\\')
      ? basenamePath(candidate)
      : candidate;
    const lowered = normalizedCandidate.toLowerCase();
    if (REPO_TARGET_STOPWORDS.has(lowered)) continue;
    return { targetRepo: normalizedCandidate, weakBareToken };
  }
  return null;
}

export function extractExplicitRepoTarget(instruction: string): string | null {
  return extractExplicitRepoTargetDetails(instruction)?.targetRepo ?? null;
}

function isExistingDirectory(pathValue: string): boolean {
  try {
    return existsSync(pathValue) && statSync(pathValue).isDirectory();
  } catch {
    return false;
  }
}

function isLikelyRepoReference(targetRepo: string, workDir: string): boolean {
  if (/[\d-]/.test(targetRepo)) return true;
  const normalizedWorkDir = resolve(workDir);
  const candidates = [
    resolve(normalizedWorkDir, targetRepo),
    resolve(dirname(normalizedWorkDir), targetRepo),
    resolve(dirname(dirname(normalizedWorkDir)), targetRepo),
  ];
  return candidates.some((candidate) => isExistingDirectory(candidate));
}

export function detectRepoTargetMismatch(
  instruction: string,
  workDir: string,
): { targetRepo: string; activeRepo: string } | null {
  const target = extractExplicitRepoTargetDetails(instruction);
  if (!target) return null;
  const { targetRepo, weakBareToken } = target;
  if (weakBareToken && !isLikelyRepoReference(targetRepo, workDir)) return null;
  const activeRepo = basenamePath(workDir);
  if (!activeRepo) return null;
  const normalizedTarget = targetRepo.toLowerCase();
  if (
    normalizedTarget === activeRepo ||
    activeRepo.endsWith(`-${normalizedTarget}`) ||
    normalizedTarget.endsWith(`-${activeRepo}`)
  ) {
    return null;
  }
  return { targetRepo, activeRepo };
}

export function evaluateCandidateEditPath(params: {
  instruction: string;
  steps: PlanStep[];
  editedPaths: string[];
  candidatePath: string;
}): ScopeGuardResult {
  const constraints = deriveScopeConstraints(params.instruction);
  const candidate = normalizePath(params.candidatePath);
  const edited = params.editedPaths.map(normalizePath);
  if (constraints.strictSingleFile && edited.length > 0) {
    const primary = edited[0]!;
    if (!pathMatchesAny(candidate, [primary])) {
      return {
        ok: false,
        reason: `Instruction requested exactly one file change; refusing edit outside ${primary}.`,
      };
    }
  }
  if (constraints.explicitFiles.length > 0 && !pathMatchesAny(candidate, constraints.explicitFiles)) {
    return {
      ok: false,
      reason: `Refusing edit outside explicit targets: ${candidate}`,
    };
  }
  if (constraints.disallowUnrelatedFiles) {
    const planned = uniquePlannedPaths(params.steps);
    const allowed = [...planned, ...constraints.explicitFiles];
    if (allowed.length > 0 && !pathMatchesAny(candidate, allowed)) {
      return {
        ok: false,
        reason: `Refusing edit outside planned scope: ${candidate}`,
      };
    }
  }
  return { ok: true, reason: null };
}
