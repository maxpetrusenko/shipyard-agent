/**
 * Supervisor: decomposes task into parallel subtasks and dispatches workers.
 *
 * Uses LangGraph Send() for parallel worker dispatch.
 * Collects results and detects file conflicts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../config/model-policy.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface SubTask {
  id: string;
  description: string;
  files: string[];
  role?: string;
}

const DECOMPOSE_SYSTEM = `You are a task supervisor. Decompose the given task into independent subtasks that can be executed in parallel by separate coding agents.

Rules:
- Each subtask should be self-contained and work on different files when possible
- If tasks MUST touch the same file, flag them as sequential (not parallel)
- Keep subtasks focused: one concern per subtask

Output as JSON:
{"subtasks": [{"id": "1", "description": "...", "files": ["..."], "role": "frontend|backend|test"}], "sequential_pairs": [["1", "2"]]}`;

export async function decomposeTask(
  instruction: string,
): Promise<{ subtasks: SubTask[]; sequentialPairs: string[][] }> {
  const config = getModelConfig('planning');
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: DECOMPOSE_SYSTEM,
    messages: [{ role: 'user', content: instruction }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const jsonMatch = text.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        subtasks: SubTask[];
        sequential_pairs?: string[][];
      };
      return {
        subtasks: parsed.subtasks,
        sequentialPairs: parsed.sequential_pairs ?? [],
      };
    }
  } catch {
    // Parse failed
  }

  // Fallback: single task
  return {
    subtasks: [{ id: '1', description: instruction, files: [] }],
    sequentialPairs: [],
  };
}
