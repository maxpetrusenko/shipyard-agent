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

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}

function looksLikePathToken(token: string): boolean {
  if (!token.includes('/')) return false;
  if (token.startsWith('http://') || token.startsWith('https://')) return false;
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
  const strictSingleFile = anyInstructionMatch(text, [
    /\bexactly one (existing )?file\b/,
    /\bone file only\b/,
    /\bsingle file\b/,
    /\bkeep to one file\b/,
    /\bjust one file\b/,
  ]);
  const disallowUnrelatedFiles = strictSingleFile || anyInstructionMatch(text, [
    /\bdo not (edit|modify|change) any other file\b/,
    /\bdon'?t (edit|modify|change) unrelated files\b/,
    /\bdon'?t modify unrelated files\b/,
    /\bno unrelated files\b/,
    /\bexact file only\b/,
  ]);
  return {
    strictSingleFile,
    disallowUnrelatedFiles,
    explicitFiles: parseExplicitFiles(instruction),
  };
}

export function uniqueEditedPaths(fileEdits: FileEdit[]): string[] {
  return [...new Set(fileEdits.map((e) => normalizePath(e.file_path)).filter(Boolean))];
}

function pathMatchesAny(filePath: string, candidates: string[]): boolean {
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

  if (constraints.strictSingleFile && edited.length !== 1) {
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
    if (planned.length > 0) {
      const outsidePlan = edited.filter((p) => !pathMatchesAny(p, planned));
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

export function shouldRequireEdits(instruction: string): boolean {
  const text = instruction.toLowerCase();
  return anyInstructionMatch(text, [
    /\b(make|apply|add|update|change|edit|modify|fix|refactor|implement)\b/,
    /\bbugfix\b/,
  ]);
}
