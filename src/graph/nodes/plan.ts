/**
 * Plan node: Opus decomposes instruction into executable steps.
 *
 * Reads relevant files, analyzes the codebase, and produces a step-by-step plan.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../../config/model-policy.js';
import { getClient, wrapSystemPrompt } from '../../config/client.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import type { ShipyardStateType, PlanStep, LLMMessage } from '../state.js';

const WORK_DIR = process.env['SHIPYARD_WORK_DIR'] ?? process.cwd();

const PLAN_SYSTEM = `You are Shipyard, an autonomous coding agent. You are in the PLANNING phase.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using tools, always use absolute paths (e.g. ${WORK_DIR}/src/index.ts).
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

Your job: decompose the user's instruction into concrete, executable steps.

## CRITICAL: Be EXHAUSTIVE

You MUST identify ALL files that need changes, not just a sample or subset.

- If the instruction implies a codebase-wide change (e.g. "enable strict TypeScript", "rename X to Y everywhere", "add logging to all handlers"), you MUST use grep/glob to find EVERY file affected.
- Do NOT stop after finding 1-2 files. Search thoroughly: use glob patterns (e.g. "**/*.ts"), grep for relevant patterns, and enumerate the full list.
- When in doubt, include more files rather than fewer. Missing a file is worse than including an extra one.
- Group related files into steps for efficiency (e.g. "Update all route handlers in src/routes/"), but list every file explicitly in the step's files array.

## Planning process

1. Read the instruction carefully. Identify what "complete" looks like.
2. Use tools to explore: glob for file patterns, grep for code patterns, read key files.
3. Build a comprehensive file list. Verify you haven't missed anything.
4. Create steps that cover ALL identified files.

For each step, specify:
- A clear description of what to do
- Which files need to be read or modified (use absolute paths) — list ALL of them
- The order matters: dependencies first

You have tools to explore the codebase (read_file, grep, glob, ls, bash).
Use them to understand the codebase before making your plan.

After exploration, output your plan as a JSON array wrapped in <plan> tags:
<plan>
[
  {"index": 0, "description": "...", "files": ["${WORK_DIR}/path/to/file.ts"]},
  {"index": 1, "description": "...", "files": ["${WORK_DIR}/path/to/other.ts"]}
]
</plan>

Plans can be 1-30 steps depending on scope. A codebase-wide change may require many steps — that is expected and correct. Do NOT artificially limit the plan size.`;

export async function planNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getModelConfig('planning');
  const anthropic = getClient();

  // Build context from injected contexts
  const contextBlock = state.contexts
    .map((c) => `## ${c.label}\n${c.content}`)
    .join('\n\n');

  const systemPrompt = wrapSystemPrompt(
    contextBlock
      ? `${PLAN_SYSTEM}\n\n# Injected Context\n\n${contextBlock}`
      : PLAN_SYSTEM,
  );

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: state.instruction },
  ];

  // If we have review feedback (retry loop), include it
  if (state.reviewFeedback) {
    messages.push({
      role: 'assistant',
      content: `Previous attempt feedback: ${state.reviewFeedback}`,
    });
    messages.push({
      role: 'user',
      content: 'Please revise your plan based on the feedback above.',
    });
  }

  const newMessages: LLMMessage[] = [...state.messages];
  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;

  // Agentic tool loop: let Opus explore the codebase
  let steps: PlanStep[] = [];
  const maxToolRounds = 30;

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      tools: TOOL_SCHEMAS.filter((t) =>
        ['read_file', 'grep', 'glob', 'ls', 'bash'].includes(t.name),
      ),
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    // Collect text + tool_use blocks
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    // Check for plan in text
    const fullText = textBlocks.map((b) => b.text).join('');
    const planMatch = fullText.match(/<plan>([\s\S]*?)<\/plan>/);
    if (planMatch) {
      try {
        const parsed = JSON.parse(planMatch[1]!) as Array<{
          index: number;
          description: string;
          files: string[];
        }>;
        steps = parsed.map((s) => ({
          ...s,
          status: 'pending' as const,
        }));
      } catch {
        // Plan parse failed, continue loop
      }
    }

    if (steps.length > 0 || response.stop_reason === 'end_turn') {
      newMessages.push({ role: 'assistant', content: fullText });
      break;
    }

    // Execute tool calls
    if (toolBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tb of toolBlocks) {
        const result = await dispatchTool(
          tb.name,
          tb.input as Record<string, unknown>,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result).slice(0, 50_000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      // No tools, no plan — break
      newMessages.push({ role: 'assistant', content: fullText });
      break;
    }
  }

  // If no structured plan was extracted, create a single-step fallback
  if (steps.length === 0) {
    steps = [
      {
        index: 0,
        description: state.instruction,
        files: [],
        status: 'pending',
      },
    ];
  }

  return {
    phase: 'executing',
    steps,
    currentStepIndex: 0,
    messages: newMessages,
    tokenUsage: { input: inputTokens, output: outputTokens },
    modelHint: 'sonnet',
  };
}
