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
- If tasks MUST touch the same file, flag them as sequential (not parallel)
- Keep subtasks focused: one concern per subtask

Output as JSON:
{"subtasks": [{"id": "1", "description": "...", "files": ["..."], "role": "frontend|backend|test"}], "sequential_pairs": [["1", "2"]]}`;

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

function extractJsonPayload(text: string): {
  subtasks: SubTask[];
  sequentialPairs: string[][];
} | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      subtasks: SubTask[];
      sequential_pairs?: string[][];
    };
    return {
      subtasks: parsed.subtasks,
      sequentialPairs: parsed.sequential_pairs ?? [],
    };
  } catch {
    return null;
  }
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
  if (parsed && parsed.subtasks.length > 0) return parsed;

  // Fallback: single task
  return {
    subtasks: [{ id: '1', description: instruction, files: [] }],
    sequentialPairs: [],
  };
}
