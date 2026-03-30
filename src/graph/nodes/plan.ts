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
import { messagesCreate } from '../../config/messages-create.js';
import {
  dispatchAnthropicToolBlocks,
  stripToolResultCacheControls,
} from '../../llm/anthropic-tool-dispatch.js';
import { compactAnthropicMessages } from '../../llm/message-compaction.js';
import {
  extractTextFromContentBlocks,
  extractToolUseBlocks,
} from '../../llm/anthropic-parse.js';
import { TokenAccumulator } from '../../llm/token-usage.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import { createPlanLiveHooks } from '../../tools/hooks.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import {
  constrainPlanStepsToScope,
  deriveScopeConstraints,
} from '../guards.js';
import { traceParser } from '../../runtime/trace-helpers.js';
import {
  buildContextBlock,
  type ShipyardStateType,
  type PlanStep,
  type LLMMessage,
} from '../state.js';

function buildCompletedStepsSummary(steps: PlanStep[]): string {
  const completed = steps.filter((s) => s.status === 'done');
  if (completed.length === 0) return '';
  const lines = completed.map(
    (s) => `  - Step ${s.index}: ${s.description} [files: ${s.files.join(', ') || 'none'}]`,
  );
  return `Previously completed steps (${completed.length}/${steps.length}):\n${lines.join('\n')}`;
}

function buildPlanSystem(workDir: string): string {
  return `You are Shipyard, an autonomous coding agent. You are in the PLANNING phase.

IMPORTANT: The target codebase is at: ${workDir}
All file paths must be absolute, rooted at ${workDir}.
When using tools, always use absolute paths (e.g. ${workDir}/src/index.ts).
When using bash, always cd to ${workDir} first or use absolute paths.

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

Bootstrap rule:
- If the selected workdir is empty, mostly empty, or not yet a git repo, but the user asked to build, rebuild, scaffold, or create an app there, treat that directory as the intended target and plan the bootstrap work in place.
- Do NOT redirect to a sibling repo just because the current directory starts empty.
- You may plan creating the initial app structure and running git init if that helps establish the new project.
- When bootstrapping a new app, include whatever minimal verification surface is needed for the final repo gate to pass (for JS/TS apps: installable deps plus working dev/build/test scripts, and add a tiny smoke test if the app starts from zero tests).

Hard scope rules:
- If the instruction names explicit target files, plan ONLY those files.
- Do not add unrelated files when the instruction already pins the target path.
- If the explicit target already appears satisfied, keep the plan minimal and focused on confirming that no-op.

## CRITICAL: Shared file safety (hub file protection)

Before editing any file, check how many other files import it:
  grep -rl "from.*<filename>" <workdir>/src --include="*.ts" | wc -l

If a file is imported by >8 other files, it is a "hub file". NEVER change its exported symbols directly.

Instead, use the adapter/re-export pattern:
1. Create a new implementation file alongside it (e.g. auth-v2.ts)
2. Update the hub file to re-export from the new file (preserving ALL existing export names)
3. Migrate consumers in batches if needed
4. Remove old code only after all consumers are migrated

This prevents 700+ cascade type errors from breaking downstream importers.

Common hub files to watch for: auth.ts, visibility.ts, types.ts, index.ts, utils.ts, config.ts, middleware.ts.
When in doubt, check with grep before planning edits to any shared utility or middleware file.

For each step, specify:
- A clear description of what to do
- Which files need to be read or modified (use absolute paths) — list ALL of them
- The order matters: dependencies first

You have tools to explore the codebase (read_file, grep, glob, ls, bash).
Use them to understand the codebase before making your plan.

After exploration, output your plan as a JSON array wrapped in <plan> tags:
<plan>
[
  {"index": 0, "description": "...", "files": ["${workDir}/path/to/file.ts"]},
  {"index": 1, "description": "...", "files": ["${workDir}/path/to/other.ts"]}
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
}

const PLAN_COMPACTION_MAX_CHARS = 100_000;

function derivePlanToolRoundLimit(instruction: string): number {
  const constraints = deriveScopeConstraints(instruction);
  if (constraints.strictSingleFile) return 4;
  if (constraints.disallowUnrelatedFiles) return 6;
  return 15;
}

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

function finalizePlan(instruction: string, steps: PlanStep[]): PlanStep[] {
  return constrainPlanStepsToScope(
    instruction,
    pruneRedundantVerificationSteps(steps),
  );
}

/**
 * When replanning, merge completed step status from the previous plan.
 * Matches old completed steps to new steps by file overlap (≥50%).
 * Ensures at least one step remains pending (since we're replanning for a reason).
 */
export function mergeCompletedSteps(
  oldSteps: PlanStep[],
  newSteps: PlanStep[],
): { steps: PlanStep[]; firstPendingIndex: number } {
  const completedOld = oldSteps.filter((s) => s.status === 'done');
  if (completedOld.length === 0 || newSteps.length === 0) {
    return { steps: newSteps, firstPendingIndex: 0 };
  }

  // Track which old steps have been matched to avoid double-matching
  const matchedOld = new Set<number>();

  const merged = newSteps.map((newStep) => {
    if (newStep.files.length === 0) return newStep;
    const match = completedOld.find((oldStep, idx) => {
      if (matchedOld.has(idx)) return false;
      if (oldStep.files.length === 0) return false;
      const overlap = newStep.files.filter((f) => oldStep.files.includes(f));
      return overlap.length / Math.max(newStep.files.length, 1) >= 0.5;
    });
    if (match) {
      matchedOld.add(completedOld.indexOf(match));
      return { ...newStep, status: 'done' as const };
    }
    return newStep;
  });

  // Safety: if ALL steps would be marked done, keep the last one pending
  // (we're replanning because something needs fixing)
  const allDone = merged.every((s) => s.status === 'done');
  if (allDone && merged.length > 0) {
    merged[merged.length - 1] = { ...merged[merged.length - 1]!, status: 'pending' as const };
  }

  const firstPending = merged.findIndex((s) => s.status !== 'done');
  return {
    steps: merged,
    firstPendingIndex: firstPending === -1 ? 0 : firstPending,
  };
}

export function checkPlanComplexity(steps: PlanStep[]): string | null {
  const uniqueFiles = new Set(steps.flatMap((s) => s.files));
  const stepCount = steps.length;
  const fileCount = uniqueFiles.size;
  if (stepCount > 7 || fileCount > 20) {
    return `[Plan Warning] This plan has ${stepCount} steps targeting ${fileCount} files. Consider decomposing into smaller runs.`;
  }
  return null;
}

export async function planNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const config = getResolvedModelConfigFromState('planning', state);
  const workDir = state.workDir?.trim() || process.cwd();
  const planSystem = buildPlanSystem(workDir);

  // Build context from injected contexts (separate cache breakpoint)
  const contextBlock = buildContextBlock(state.contexts);

  // Build completed-steps context for replan
  const isReplan = !!state.reviewFeedback;
  const completedStepsSummary = isReplan
    ? buildCompletedStepsSummary(state.steps)
    : '';

  if (isOpenAiModelId(config.model)) {
    const rawSystem = contextBlock
      ? `${planSystem}\n\n# Injected Context\n\n${contextBlock}`
      : planSystem;
    let initialUserText = state.instruction;
    if (state.reviewFeedback) {
      initialUserText = `${state.instruction}\n\nPrevious attempt feedback: ${state.reviewFeedback}\n\n${completedStepsSummary}\n\nPlease revise your plan based on the feedback above. Steps already completed do not need to be re-done unless the feedback specifically requires reworking them.`;
    }
    const {
      steps,
      newMessages,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheCreation,
    } =
      await runOpenAiPlanLoop({
        state,
        config,
        system: rawSystem,
        initialUserText,
        runId: state.runId,
      });
    const finalizedSteps = finalizePlan(state.instruction, steps);

    // Merge completed step status from prior plan
    const { steps: mergedSteps, firstPendingIndex } = isReplan
      ? mergeCompletedSteps(state.steps, finalizedSteps)
      : { steps: finalizedSteps, firstPendingIndex: 0 };

    const complexityWarning = checkPlanComplexity(mergedSteps);
    if (complexityWarning) {
      newMessages.push({ role: 'assistant', content: complexityWarning });
    }
    if (isReplan) {
      const doneCount = mergedSteps.filter((s) => s.status === 'done').length;
      newMessages.push({
        role: 'assistant',
        content: `[Replan] Preserved ${doneCount}/${mergedSteps.length} completed steps from prior plan. Resuming from step ${firstPendingIndex}.`,
      });
    }
    return {
      phase: 'executing',
      steps: mergedSteps,
      currentStepIndex: firstPendingIndex,
      currentStepEditBaseline: state.fileEdits.length,
      messages: newMessages,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        cacheRead,
        cacheCreation,
      },
      modelHint: 'sonnet',
    };
  }

  const anthropic = getClient();

  const systemPrompt = wrapSystemPrompt(
    planSystem,
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
      content: `${completedStepsSummary}\n\nPlease revise your plan based on the feedback above. Steps already completed do not need to be re-done unless the feedback specifically requires reworking them.`,
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
  const maxToolRounds = derivePlanToolRoundLimit(state.instruction);

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
    const compacted = compactAnthropicMessages(requestMessages, {
      maxChars: PLAN_COMPACTION_MAX_CHARS,
      preserveRecentMessages: 8,
    });
    if (compacted.compacted) {
      newMessages.push({
        role: 'assistant',
        content:
          `[Compaction] planning history compacted (${compacted.beforeChars} -> ${compacted.afterChars} chars, dropped ${compacted.droppedMessages} messages).`,
      });
    }
    const response = await messagesCreate(anthropic, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: systemPrompt,
      tools: planTools,
      messages: compacted.messages,
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
        const parsed = await traceParser('plan_extraction', async () => {
          const result = JSON.parse(planMatch[1]!) as Array<{
            index: number;
            description: string;
            files: string[];
          }>;
          return { steps: result, stepCount: result.length };
        }, fullText);
        steps = parsed.steps.map((s) => ({
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
        (name, input) => dispatchTool(name, input, createPlanLiveHooks(), undefined, workDir),
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
  steps = finalizePlan(state.instruction, steps);

  // Merge completed step status from prior plan
  const { steps: mergedSteps, firstPendingIndex } = isReplan
    ? mergeCompletedSteps(state.steps, steps)
    : { steps, firstPendingIndex: 0 };

  const complexityWarning = checkPlanComplexity(mergedSteps);
  if (complexityWarning) {
    newMessages.push({ role: 'assistant', content: complexityWarning });
  }
  if (isReplan) {
    const doneCount = mergedSteps.filter((s) => s.status === 'done').length;
    newMessages.push({
      role: 'assistant',
      content: `[Replan] Preserved ${doneCount}/${mergedSteps.length} completed steps from prior plan. Resuming from step ${firstPendingIndex}.`,
    });
  }

  return {
    phase: 'executing',
    steps: mergedSteps,
    currentStepIndex: firstPendingIndex,
    currentStepEditBaseline: state.fileEdits.length,
    messages: newMessages,
    tokenUsage: tokens.snapshot(),
    modelHint: 'sonnet',
  };
}
