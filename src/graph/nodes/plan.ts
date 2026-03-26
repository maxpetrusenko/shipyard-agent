/**
 * Plan node: Opus decomposes instruction into executable steps.
 *
 * Reads relevant files, analyzes the codebase, and produces a step-by-step plan.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getResolvedModelConfigFromState,
  isOpenAiModelId,
} from '../../config/model-policy.js';
import { runOpenAiPlanLoop } from './plan-openai.js';
import {
  getClient,
  wrapSystemPrompt,
  withCachedTools,
} from '../../config/client.js';
import { WORK_DIR } from '../../config/work-dir.js';
import { messagesCreate } from '../../config/messages-create.js';
import {
  dispatchAnthropicToolBlocks,
  stripToolResultCacheControls,
} from '../../llm/anthropic-tool-dispatch.js';
import {
  extractTextFromContentBlocks,
  extractToolUseBlocks,
} from '../../llm/anthropic-parse.js';
import { TokenAccumulator } from '../../llm/token-usage.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import { createPlanLiveHooks } from '../../tools/hooks.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import {
  buildContextBlock,
  type ShipyardStateType,
  type PlanStep,
  type LLMMessage,
} from '../state.js';

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

Plans can be 1-30 steps depending on scope. A codebase-wide change may require many steps — that is expected and correct. Do NOT artificially limit the plan size.

Verification policy:
- Do NOT create standalone steps that only run \`pnpm type-check\`, \`pnpm test\`, or other full verification commands.
- The pipeline runs verification automatically after execution.
- Only include a manual verification command step when the user explicitly asks for a specific diagnostic command output.

## Codebase conventions
- This codebase uses TypeScript with \`moduleResolution: "node16"\`. ALL imports MUST include the \`.js\` extension (e.g. \`import { foo } from './bar.js'\`), even for \`.ts\` source files.
- Use vitest for testing. Import from 'vitest' not '@jest/globals'.`;

function isStandaloneVerificationStep(step: PlanStep): boolean {
  const desc = step.description.toLowerCase();
  const mentionsVerify =
    desc.includes('type-check') ||
    desc.includes('typecheck') ||
    desc.includes('pnpm test') ||
    desc.includes('run tests') ||
    desc.includes('verification');
  const looksLikeEdit =
    desc.includes('add ') ||
    desc.includes('update ') ||
    desc.includes('edit ') ||
    desc.includes('refactor ') ||
    desc.includes('rename ') ||
    desc.includes('implement ');
  return mentionsVerify && !looksLikeEdit && step.files.length === 0;
}

function pruneRedundantVerificationSteps(steps: PlanStep[]): PlanStep[] {
  const hasImplementationStep = steps.some((s) => !isStandaloneVerificationStep(s));
  if (!hasImplementationStep) return steps;
  const filtered = steps.filter((s) => !isStandaloneVerificationStep(s));
  if (filtered.length === 0) return steps;
  return filtered.map((s, i) => ({ ...s, index: i }));
}

export async function planNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('planning', state);

  // Build context from injected contexts (separate cache breakpoint)
  const contextBlock = buildContextBlock(state.contexts);

  if (isOpenAiModelId(config.model)) {
    const rawSystem = contextBlock
      ? `${PLAN_SYSTEM}\n\n# Injected Context\n\n${contextBlock}`
      : PLAN_SYSTEM;
    let initialUserText = state.instruction;
    if (state.reviewFeedback) {
      initialUserText = `${state.instruction}\n\nPrevious attempt feedback: ${state.reviewFeedback}\n\nPlease revise your plan based on the feedback above.`;
    }
    const { steps, newMessages, inputTokens, outputTokens } =
      await runOpenAiPlanLoop({
        state,
        config,
        system: rawSystem,
        initialUserText,
        runId: state.runId,
      });
    return {
      phase: 'executing',
      steps: pruneRedundantVerificationSteps(steps),
      currentStepIndex: 0,
      messages: newMessages,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        cacheRead: state.tokenUsage?.cacheRead ?? 0,
        cacheCreation: state.tokenUsage?.cacheCreation ?? 0,
      },
      modelHint: 'sonnet',
    };
  }

  const anthropic = getClient();

  const systemPrompt = wrapSystemPrompt(
    PLAN_SYSTEM,
    contextBlock ? `# Injected Context\n\n${contextBlock}` : undefined,
  );

  const planTools = withCachedTools(
    TOOL_SCHEMAS.filter((t) =>
      ['read_file', 'grep', 'glob', 'ls', 'bash'].includes(t.name),
    ),
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
  const tokens = new TokenAccumulator({
    input: state.tokenUsage?.input,
    output: state.tokenUsage?.output,
    cacheRead: state.tokenUsage?.cacheRead,
    cacheCreation: state.tokenUsage?.cacheCreation,
  });

  // Agentic tool loop: let Opus explore the codebase
  let steps: PlanStep[] = [];
  const maxToolRounds = 15;

  for (let round = 0; round < maxToolRounds; round++) {
    const liveFollowups = consumeLiveFollowups(state.runId);
    if (liveFollowups.length > 0) {
      messages.push({
        role: 'user',
        content: liveFollowups.join('\n\n'),
      });
      newMessages.push({
        role: 'assistant',
        content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before planning call.`,
      });
    }

    const requestMessages = stripToolResultCacheControls(messages);
    const response = await messagesCreate(anthropic, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      tools: planTools,
      messages: requestMessages,
    }, {
      liveNode: 'plan',
      traceName: 'plan',
      traceMetadata: { node: 'plan', provider: 'anthropic', model: config.model },
      traceTags: ['shipyard', 'plan', 'anthropic'],
    });

    tokens.addAnthropicRound(response);

    const fullText = extractTextFromContentBlocks(response.content);
    const toolBlocks = extractToolUseBlocks(response.content);

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

      const toolResults = await dispatchAnthropicToolBlocks(
        toolBlocks,
        (name, input) => dispatchTool(name, input, createPlanLiveHooks()),
      );
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
  steps = pruneRedundantVerificationSteps(steps);

  return {
    phase: 'executing',
    steps,
    currentStepIndex: 0,
    messages: newMessages,
    tokenUsage: tokens.snapshot(),
    modelHint: 'sonnet',
  };
}
