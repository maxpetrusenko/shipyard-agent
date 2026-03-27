/**
 * Deterministic guardrails for scope/completeness checks.
 */

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

export function pathMatchesAny(filePath: string, candidates: string[]): boolean {
  const fp = normalizePath(filePath);
  return candidates.some((raw) => {
    const cand = normalizePath(raw);
    return fp === cand || fp.endsWith(`/${cand}`) || cand.endsWith(`/${fp}`);
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
  /\b(make|apply|add|update|change|edit|modify|fix|refactor|implement|create|write|remove|delete|replace|rename|move|insert|patch|document)\b/,
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

export function extractExplicitRepoTarget(instruction: string): string | null {
  const patterns = [
    /^\s*in\s+([a-zA-Z0-9._-]+)\s*(?:,|\n|$)/im,
    /\b(?:in|inside|within)\s+([a-zA-Z0-9._-]+)\s+(?:repo|repository|project|codebase)\b/i,
  ];
  for (const pattern of patterns) {
    const m = instruction.match(pattern);
    const candidate = m?.[1]?.trim();
    if (!candidate) continue;
    const lowered = candidate.toLowerCase();
    if (REPO_TARGET_STOPWORDS.has(lowered)) continue;
    return candidate;
  }
  return null;
}

export function detectRepoTargetMismatch(
  instruction: string,
  workDir: string,
): { targetRepo: string; activeRepo: string } | null {
  const targetRepo = extractExplicitRepoTarget(instruction);
  if (!targetRepo) return null;
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
