/**
 * Classify whether a run should stay in Q&A mode vs full codegen pipeline.
 */

import { completeTextForRole } from '../llm/complete-text.js';
import type { ShipyardStateType } from './state.js';

/** Strong signals the user wants repo / code work (not casual Q&A). */
const CODE_HINT =
  /\b(refactor|implement|re-?implement|fix\s|bug\b|add\s+(a\s+)?(test|file|route|handler|component|endpoint)|create\s+(a\s+)?(file|component|route|test)|delete\s|remove\s|update\s|change\s|migrate|rename\b|extract\s|wire\s|hook\s|typescript|typecheck|eslint|vitest|pnpm\s|npm\s|import\s+[\w*{}\s,]+from|\.tsx?\b|\.jsx?\b|src\/|packages\/|codebase|repository|pull\s+request|commit\b|branch\b|test\s+failure|failing\s+test|open\s+pr|shipyard)\b/i;

export function looksLikeCodeRequest(instruction: string): boolean {
  const t = instruction.trim();
  if (t.length > 6000) return true;
  if (CODE_HINT.test(t)) return true;
  if (/[`][^`]+\.(ts|tsx|js|jsx|json|md|mjs|cjs)[`]/.test(t)) return true;
  return false;
}

/**
 * Safe shortcut for simple arithmetic (e.g. "2+2") without LLM.
 * Only allows digits and + - * / ( ) . in the compacted expression.
 */
export function tryArithmeticShortcut(instruction: string): string | null {
  const raw = instruction.trim();
  if (raw.length > 64) return null;
  let compact = raw.replace(/\s+/g, '').replace(/\?+$/, '');
  if (!compact || compact.includes('?')) return null;
  if (!/^[\d+\-*/().<>=!]+$/.test(compact)) return null;
  compact = compact.replace(/(?<![<>=!])=(?![=])/g, '===');
  try {
    const fn = new Function(`"use strict"; return (${compact});`);
    const v = fn();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return String(v);
  } catch {
    return null;
  }
  return null;
}

/**
 * Instant shortcut for trivial chat greetings in Ask mode.
 * Avoids model round-trips for messages like "hi".
 */
export function tryChatShortcut(instruction: string): string | null {
  const raw = instruction.trim().toLowerCase();
  if (!raw || raw.length > 32) return null;
  if (/^(hi|hello|hey|yo|sup|what'?s up)[!.?]*$/.test(raw)) {
    return 'Hi. How can I help?';
  }
  if (/^(thanks|thank you|thx)[!.?]*$/.test(raw)) {
    return 'You’re welcome.';
  }
  return null;
}

const CLASSIFIER_SYSTEM = `You classify a single user message for a coding agent dashboard.

Reply with exactly one word, uppercase:
- CODE — the user wants work on a software project (edit files, run tests, fix bugs, add features, explore the repo to implement something).
- CHAT — greetings, math, general knowledge, opinion, or questions that do not ask to change this codebase.

Examples:
"2+2" -> CHAT
"what is 2+2" -> CHAT
"add JWT to auth middleware" -> CODE
"run tests" -> CODE`;

export async function classifyIntentLlm(
  state: ShipyardStateType,
  instruction: string,
): Promise<{ intent: 'chat' | 'code'; inputTokens: number; outputTokens: number }> {
  const trimmed = instruction.trim().slice(0, 4000);
  if (!trimmed) {
    return { intent: 'code', inputTokens: 0, outputTokens: 0 };
  }

  const { text, inputTokens, outputTokens } = await completeTextForRole(
    state,
    'intent',
    CLASSIFIER_SYSTEM,
    [{ role: 'user', content: trimmed }],
  );

  const upper = text.trim().toUpperCase();
  const intent = upper.includes('CODE') ? 'code' : 'chat';
  return {
    intent,
    inputTokens,
    outputTokens,
  };
}
