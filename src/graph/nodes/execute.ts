/**
 * Execute node: Sonnet executes the current step via tool calls.
 *
 * The LLM gets the current step description and uses tools to implement it.
 * Tool calls are recorded via hooks; file overlay enables rollback.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelConfig } from '../../config/model-policy.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import { createRecordingHooks } from '../../tools/hooks.js';
import { FileOverlay } from '../../tools/file-overlay.js';
import type {
  ShipyardStateType,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
} from '../state.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const WORK_DIR = process.env['SHIPYARD_WORK_DIR'] ?? process.cwd();

const EXECUTE_SYSTEM = `You are Shipyard, an autonomous coding agent. You are in the EXECUTION phase.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using tools, always use absolute paths (e.g. ${WORK_DIR}/src/index.ts).
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

You are executing a specific step of a larger plan. Use the available tools to implement the change.

Rules:
- Read files before editing (understand before modifying)
- Use edit_file for surgical changes (preferred over write_file)
- Use write_file only for new files
- Use bash for running commands (build, lint, format) — always cd to ${WORK_DIR} first
- Make one logical change at a time
- When done with this step, say "STEP_COMPLETE" in your response`;

export async function executeNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getModelConfig('coding');
  const anthropic = getClient();

  const currentStep = state.steps[state.currentStepIndex];
  if (!currentStep) {
    return {
      phase: 'error',
      error: `No step at index ${state.currentStepIndex}`,
    };
  }

  // Build context
  const contextBlock = state.contexts
    .map((c) => `## ${c.label}\n${c.content}`)
    .join('\n\n');

  const systemPrompt = contextBlock
    ? `${EXECUTE_SYSTEM}\n\n# Context\n\n${contextBlock}`
    : EXECUTE_SYSTEM;

  const stepPrompt = [
    `## Current Step (${currentStep.index + 1}/${state.steps.length})`,
    currentStep.description,
    currentStep.files.length > 0
      ? `Files: ${currentStep.files.join(', ')}`
      : '',
    '',
    '## Full Plan',
    ...state.steps.map(
      (s) =>
        `${s.index === state.currentStepIndex ? '→' : ' '} ${s.index + 1}. [${s.status}] ${s.description}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: stepPrompt },
  ];

  let inputTokens = state.tokenUsage?.input ?? 0;
  let outputTokens = state.tokenUsage?.output ?? 0;
  const newEdits: FileEdit[] = [...state.fileEdits];
  const newHistory: ToolCallRecord[] = [...state.toolCallHistory];
  const newMessages: LLMMessage[] = [...state.messages];
  const maxToolRounds = 25;

  // Hook-based recording + file overlay for rollback
  const hooks = createRecordingHooks(newEdits, newHistory);
  const overlay = new FileOverlay();

  // Mark step as in_progress
  const updatedSteps = state.steps.map((s, i) =>
    i === state.currentStepIndex ? { ...s, status: 'in_progress' as const } : s,
  );

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      tools: TOOL_SCHEMAS,
      messages,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const fullText = textBlocks.map((b) => b.text).join('');

    // Check if step is complete
    if (fullText.includes('STEP_COMPLETE') || response.stop_reason === 'end_turn') {
      newMessages.push({ role: 'assistant', content: fullText });

      // Mark step done
      const finalSteps = updatedSteps.map((s, i) =>
        i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
      );

      return {
        phase: 'verifying',
        steps: finalSteps,
        fileEdits: newEdits,
        toolCallHistory: newHistory,
        messages: newMessages,
        tokenUsage: { input: inputTokens, output: outputTokens },
      };
    }

    // Execute tool calls (hooks handle recording, overlay handles snapshots)
    if (toolBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tb of toolBlocks) {
        const result = await dispatchTool(
          tb.name,
          tb.input as Record<string, unknown>,
          hooks,
          overlay,
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: JSON.stringify(result).slice(0, 50_000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      // No tools, not complete — something's wrong
      newMessages.push({ role: 'assistant', content: fullText });
      break;
    }
  }

  // If we hit max rounds without STEP_COMPLETE, mark step as done anyway
  const finalSteps = updatedSteps.map((s, i) =>
    i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
  );

  return {
    phase: 'verifying',
    steps: finalSteps,
    fileEdits: newEdits,
    toolCallHistory: newHistory,
    messages: newMessages,
    tokenUsage: { input: inputTokens, output: outputTokens },
  };
}
