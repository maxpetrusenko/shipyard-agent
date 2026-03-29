/**
 * Supervisor: decomposes task into parallel subtasks and dispatches workers.
 *
 * Uses LangGraph Send() for parallel worker dispatch.
 * Collects results and detects file conflicts.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getRateLimitFallbackModel,
  getResolvedModelConfig,
  isOpenAiModelId,
  type ModelFamily,
  type ModelRole,
} from '../config/model-policy.js';
import { getClient, wrapSystemPrompt } from '../config/client.js';
import { messagesCreate } from '../config/messages-create.js';
import { getOpenAIClient } from '../config/openai-client.js';
import {
  assistantTextContent,
  chatCompletionCreateWithRetry,
} from '../llm/openai-helpers.js';

export interface SubTask {
  id: string;
  description: string;
  files: string[];
  role?: string;
}

export interface ModelSelection {
  modelOverride?: string | null;
  modelFamily?: ModelFamily | null;
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
}

const DECOMPOSE_SYSTEM = `You are a task supervisor. Decompose the given task into independent subtasks that can be executed in parallel by separate coding agents.

Rules:
- Each subtask should be self-contained and work on different files when possible
- CRITICAL: Every subtask MUST list ALL files it will read or write in the "files" array. Include files the task will likely need to modify based on imports, routes, and shared modules.
- If two subtasks share ANY file in their "files" arrays, they MUST appear together in "sequential_pairs". Parallel execution of tasks sharing files causes merge conflicts.
- Keep subtasks focused: one concern per subtask

Output as JSON:
{"subtasks": [{"id": "1", "description": "...", "files": ["..."], "role": "frontend|backend|test"}], "sequential_pairs": [["1", "2"]]}`;

/**
 * Extract relative file paths from a subtask description.
 * Matches patterns like `routes/files.ts`, `src/services/auth.ts`, `api/src/routes/files.ts`.
 * Requires at least one `/` separator and a file extension to avoid false positives.
 */
export function extractRelativePaths(description: string): string[] {
  const seen = new Set<string>();
  // Match word-char sequences with at least one `/` and a file extension
  const regex = /(?:^|\s|`|"|')([a-zA-Z0-9_@.-]+\/[a-zA-Z0-9_/.@-]+\.[a-zA-Z]{1,8})(?=$|\s|[.,;:()`"'])/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(description)) !== null) {
    const raw = m[1]?.trim();
    if (raw && !raw.startsWith('http') && !raw.startsWith('//')) {
      seen.add(raw);
    }
  }
  return [...seen];
}

/**
 * Post-decomposition validation: scan subtask descriptions for file paths
 * not listed in files[], add them, and auto-serialize tasks with shared files.
 */
export function enforceFileOwnership(
  subtasks: SubTask[],
  sequentialPairs: string[][],
): { subtasks: SubTask[]; sequentialPairs: string[][] } {
  // 1. Enrich each subtask's files[] with paths found in description
  const enriched = subtasks.map((task) => {
    const found = extractRelativePaths(task.description);
    const existing = new Set(task.files ?? []);
    for (const p of found) {
      existing.add(p);
    }
    return { ...task, files: [...existing] };
  });

  // 2. Detect cross-task file overlaps and auto-add sequential pairs
  const pairSet = new Set(sequentialPairs.map((p) => `${p[0]}:${p[1]}`));
  const newPairs = [...sequentialPairs];

  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i]!;
      const b = enriched[j]!;
      const aFiles = new Set(a.files);
      const hasOverlap = b.files.some((f) => aFiles.has(f));
      if (hasOverlap) {
        const key = `${a.id}:${b.id}`;
        const keyRev = `${b.id}:${a.id}`;
        if (!pairSet.has(key) && !pairSet.has(keyRev)) {
          newPairs.push([a.id, b.id]);
          pairSet.add(key);
          pairSet.add(keyRev);
        }
      }
    }
  }

  return { subtasks: enriched, sequentialPairs: newPairs };
}

function isRateLimitLikeError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
  const norm = msg.toLowerCase();
  return (
    norm.includes('rate_limit') ||
    norm.includes('rate limit') ||
    norm.includes('too many requests') ||
    norm.includes(' 429') ||
    norm.startsWith('429 ')
  );
}

function parseDecomposePayload(candidate: string): {
  subtasks: SubTask[];
  sequentialPairs: string[][];
} | null {
  try {
    const parsed = JSON.parse(candidate) as {
      subtasks: SubTask[];
      sequential_pairs?: string[][];
      sequentialPairs?: string[][];
    };
    if (!Array.isArray(parsed.subtasks)) return null;
    return {
      subtasks: parsed.subtasks,
      sequentialPairs:
        parsed.sequential_pairs ??
        parsed.sequentialPairs ??
        [],
    };
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) continue;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

export function extractJsonPayload(text: string): {
  subtasks: SubTask[];
  sequentialPairs: string[][];
} | null {
  const fencedBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1] ?? '')
    .filter(Boolean);
  const candidates = [text, ...fencedBlocks].flatMap(extractBalancedJsonObjects);

  for (const candidate of candidates) {
    const parsed = parseDecomposePayload(candidate);
    if (parsed) return parsed;
  }

  return null;
}

async function decomposeWithModel(
  instruction: string,
  model: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  if (isOpenAiModelId(model)) {
    const openai = getOpenAIClient();
    const completion = await chatCompletionCreateWithRetry(openai, {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: DECOMPOSE_SYSTEM },
        { role: 'user', content: instruction },
      ],
    }, {
      traceName: 'coordinate',
      traceMetadata: {
        node: 'coordinate',
        provider: 'openai',
        model,
        mode: 'decompose',
      },
      traceTags: ['shipyard', 'coordinate', 'openai'],
    });
    const choice = completion.choices[0];
    return choice ? assistantTextContent(choice.message) : '';
  }

  const anthropic = getClient();
  const response = await messagesCreate(
    anthropic,
    {
      model,
      max_tokens: maxTokens,
      temperature,
      system: wrapSystemPrompt(DECOMPOSE_SYSTEM),
      messages: [{ role: 'user', content: instruction }],
    },
    {
      liveNode: 'coordinate',
      traceName: 'coordinate',
      traceMetadata: {
        node: 'coordinate',
        provider: 'anthropic',
        model,
        mode: 'decompose',
      },
      traceTags: ['shipyard', 'coordinate', 'anthropic'],
    },
  );

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export async function decomposeTask(
  instruction: string,
  modelSelection?: ModelSelection,
): Promise<{ subtasks: SubTask[]; sequentialPairs: string[][] }> {
  const config = getResolvedModelConfig('planning', {
    modelFamily: modelSelection?.modelFamily ?? null,
    modelOverrides: modelSelection?.modelOverrides ?? null,
    legacyCodingOverride: modelSelection?.modelOverride ?? null,
  });

  let text = '';
  try {
    text = await decomposeWithModel(
      instruction,
      config.model,
      config.maxTokens,
      config.temperature,
    );
  } catch (err) {
    if (!isRateLimitLikeError(err)) throw err;
    const fallbackModel = getRateLimitFallbackModel(
      'planning',
      config.model,
    );
    text = await decomposeWithModel(
      instruction,
      fallbackModel,
      config.maxTokens,
      config.temperature,
    );
  }

  const parsed = extractJsonPayload(text);
  if (parsed && parsed.subtasks.length > 0) {
    return enforceFileOwnership(parsed.subtasks, parsed.sequentialPairs);
  }

  // Fallback: single task
  return {
    subtasks: [{ id: '1', description: instruction, files: [] }],
    sequentialPairs: [],
  };
}
