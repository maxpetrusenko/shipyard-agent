/**
 * Surgical file editing with 4-tier cascading fallback.
 *
 * Tier 1: Exact match (old_string appears once)
 * Tier 2: Whitespace-normalized match (trim + collapse per line)
 * Tier 3: Fuzzy match (Levenshtein distance < 10% of string length)
 * Tier 4: Full file rewrite (last resort, logged as degraded)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { distance as levenshtein } from 'fastest-levenshtein';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditFileParams {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface EditFileResult {
  success: boolean;
  tier: 1 | 2 | 3 | 4;
  message: string;
  diff_preview?: string;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace per line: trim + collapse inner runs to single space. */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

function normalizeBlock(text: string): string {
  return text
    .split('\n')
    .map(normalizeLine)
    .join('\n');
}

/** Build a short unified-diff-style preview. */
function buildDiffPreview(
  filePath: string,
  oldStr: string,
  newStr: string,
): string {
  const oldLines = oldStr.split('\n').map((l) => `- ${l}`);
  const newLines = newStr.split('\n').map((l) => `+ ${l}`);
  return [`--- ${filePath}`, `+++ ${filePath}`, ...oldLines, ...newLines].join(
    '\n',
  );
}

// ---------------------------------------------------------------------------
// Core: find match in content
// ---------------------------------------------------------------------------

interface MatchResult {
  tier: 1 | 2 | 3;
  start: number;
  end: number;
  matchedText: string;
}

function findExactMatch(content: string, oldString: string): MatchResult | null {
  const first = content.indexOf(oldString);
  if (first === -1) return null;
  // Check uniqueness
  const second = content.indexOf(oldString, first + 1);
  if (second !== -1) return null; // multiple matches
  return {
    tier: 1,
    start: first,
    end: first + oldString.length,
    matchedText: oldString,
  };
}

function findExactMatchCount(content: string, oldString: string): number {
  let count = 0;
  let idx = -1;
  while ((idx = content.indexOf(oldString, idx + 1)) !== -1) {
    count++;
  }
  return count;
}

function findNormalizedMatch(
  content: string,
  oldString: string,
): MatchResult | null {
  const normalizedOld = normalizeBlock(oldString);
  const lines = content.split('\n');
  const oldLineCount = oldString.split('\n').length;

  const matches: { start: number; end: number; matchedText: string }[] = [];

  for (let i = 0; i <= lines.length - oldLineCount; i++) {
    const candidateLines = lines.slice(i, i + oldLineCount);
    const normalizedCandidate = normalizeBlock(candidateLines.join('\n'));
    if (normalizedCandidate === normalizedOld) {
      const startOffset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const matchedText = candidateLines.join('\n');
      matches.push({
        start: startOffset,
        end: startOffset + matchedText.length,
        matchedText,
      });
    }
  }

  if (matches.length !== 1) return null;
  return { tier: 2, ...matches[0]! };
}

function findFuzzyMatch(
  content: string,
  oldString: string,
): MatchResult | null {
  const threshold = Math.max(1, Math.floor(oldString.length * 0.1));
  const lines = content.split('\n');
  const oldLineCount = oldString.split('\n').length;

  let bestMatch: { start: number; end: number; matchedText: string; dist: number } | null = null;

  for (let i = 0; i <= lines.length - oldLineCount; i++) {
    const candidateLines = lines.slice(i, i + oldLineCount);
    const candidateText = candidateLines.join('\n');
    const dist = levenshtein(candidateText, oldString);
    if (dist <= threshold) {
      if (!bestMatch || dist < bestMatch.dist) {
        const startOffset = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        bestMatch = {
          start: startOffset,
          end: startOffset + candidateText.length,
          matchedText: candidateText,
          dist,
        };
      }
    }
  }

  if (!bestMatch) return null;
  return { tier: 3, start: bestMatch.start, end: bestMatch.end, matchedText: bestMatch.matchedText };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function editFile(params: EditFileParams): Promise<EditFileResult> {
  const { file_path, old_string, new_string } = params;

  if (old_string === new_string) {
    return { success: false, tier: 1, message: 'old_string and new_string are identical' };
  }

  if (!old_string || old_string.trim() === '') {
    return { success: false, tier: 1, message: 'old_string cannot be empty' };
  }

  let content: string;
  let fileExists = true;
  try {
    content = await readFile(file_path, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // File doesn't exist — skip tiers 1-3, fall through to tier 4
      content = '';
      fileExists = false;
    } else if (code === 'EISDIR') {
      return {
        success: false,
        tier: 1,
        message: `Cannot edit directory as file: ${file_path}. Use the 'ls' tool to inspect directories and choose a concrete file.`,
      };
    } else {
      throw err;
    }
  }

  if (!fileExists) {
    await mkdir(dirname(file_path), { recursive: true });
    await writeFile(file_path, new_string, 'utf-8');
    return {
      success: true,
      tier: 4,
      message: `File not found. Created ${file_path} with new content (tier 4 rewrite).`,
    };
  }

  // Tier 1: Exact match
  const exactCount = findExactMatchCount(content, old_string);
  if (exactCount > 1) {
    return {
      success: false,
      tier: 1,
      message: `old_string matched ${exactCount} times. Provide more surrounding context to make it unique.`,
    };
  }

  const exact = findExactMatch(content, old_string);
  if (exact) {
    const result = content.slice(0, exact.start) + new_string + content.slice(exact.end);
    await writeFile(file_path, result, 'utf-8');
    return {
      success: true,
      tier: 1,
      message: 'Exact match replaced successfully.',
      diff_preview: buildDiffPreview(file_path, old_string, new_string),
    };
  }

  // Tier 2: Whitespace-normalized
  const normalized = findNormalizedMatch(content, old_string);
  if (normalized) {
    const result =
      content.slice(0, normalized.start) + new_string + content.slice(normalized.end);
    await writeFile(file_path, result, 'utf-8');
    return {
      success: true,
      tier: 2,
      message: 'Whitespace-normalized match replaced successfully.',
      diff_preview: buildDiffPreview(file_path, normalized.matchedText, new_string),
    };
  }

  // Tier 3: Fuzzy match
  const fuzzy = findFuzzyMatch(content, old_string);
  if (fuzzy) {
    const result =
      content.slice(0, fuzzy.start) + new_string + content.slice(fuzzy.end);
    await writeFile(file_path, result, 'utf-8');
    return {
      success: true,
      tier: 3,
      message: 'Fuzzy match replaced (Levenshtein). Review the diff carefully.',
      diff_preview: buildDiffPreview(file_path, fuzzy.matchedText, new_string),
    };
  }

  // Tier 4: Full rewrite (last resort)
  await mkdir(dirname(file_path), { recursive: true });
  await writeFile(file_path, new_string, 'utf-8');
  return {
    success: true,
    tier: 4,
    message: 'No match found. Full file rewrite applied (degraded edit).',
  };
}
