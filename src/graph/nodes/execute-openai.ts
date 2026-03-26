/**
 * Execute-node LLM loop via OpenAI Chat Completions + function tools.
 * Used when the run's coding model override is an OpenAI model id (e.g. gpt-5.1-codex).
 */
import OpenAI from 'openai';
import { getOpenAIClient } from '../../config/openai-client.js';
import type { ModelConfig } from '../../config/model-policy.js';
import { TOOL_SCHEMAS, dispatchTool } from '../../tools/index.js';
import { emitTextChunk, type ToolHooks } from '../../tools/hooks.js';
import type { FileOverlay } from '../../tools/file-overlay.js';
import { anthropicToolSchemasToOpenAi } from '../../llm/openai-tool-schemas.js';
import {
  assistantTextContent,
  addChatCompletionUsage,
  chatCompletionCreateWithRetry,
} from '../../llm/openai-helpers.js';
import { appendOpenAiToolTurn } from '../../llm/openai-chat-tool-turn.js';
import { consumeLiveFollowups } from '../../runtime/live-followups.js';
import type {
  ShipyardStateType,
  FileEdit,
  ToolCallRecord,
  LLMMessage,
} from '../state.js';

const openAiTools = anthropicToolSchemasToOpenAi(TOOL_SCHEMAS);
const MAX_NO_EDIT_TOOL_ROUNDS = 8;

export async function runOpenAiExecuteLoop(params: {
  state: ShipyardStateType;
  config: ModelConfig;
  system: string;
  stepPrompt: string;
  hooks: ToolHooks;
  overlay: FileOverlay;
  updatedSteps: ShipyardStateType['steps'];
}): Promise<Partial<ShipyardStateType>> {
  const { state, config, system, stepPrompt, hooks, overlay, updatedSteps } =
    params;
  const client = getOpenAIClient();

  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'user', content: stepPrompt },
  ];

  const usageAcc = {
    input: state.tokenUsage?.input ?? 0,
    output: state.tokenUsage?.output ?? 0,
  };
  const newEdits: FileEdit[] = [...state.fileEdits];
  const newHistory: ToolCallRecord[] = [...state.toolCallHistory];
  const newMessages: LLMMessage[] = [...state.messages];
  const maxToolRounds = 25;
  let noEditToolRounds = 0;

  const buildReturn = (
    fullText: string,
    finalSteps: ShipyardStateType['steps'],
  ): Partial<ShipyardStateType> => {
    newMessages.push({ role: 'assistant', content: fullText });
    const snapshotJson = overlay.dirty
      ? JSON.stringify(
          Object.fromEntries(overlay.trackedFiles().map((f) => [f, ''])),
        )
      : state.fileOverlaySnapshots ?? null;
    return {
      phase: 'verifying',
      steps: finalSteps,
      fileEdits: newEdits,
      toolCallHistory: newHistory,
      messages: newMessages,
      tokenUsage: { input: usageAcc.input, output: usageAcc.output },
      fileOverlaySnapshots: snapshotJson,
    };
  };

  for (let round = 0; round < maxToolRounds; round++) {
    const liveFollowups = consumeLiveFollowups(state.runId);
    if (liveFollowups.length > 0) {
      conversation.push({
        role: 'user',
        content: liveFollowups.join('\n\n'),
      });
      newMessages.push({
        role: 'assistant',
        content: `[Follow-up] Consumed ${liveFollowups.length} queued user update(s) before execution call.`,
      });
    }

    const completion = await chatCompletionCreateWithRetry(client, {
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [{ role: 'system', content: system }, ...conversation],
      tools: openAiTools,
      tool_choice: 'auto',
    }, {
      traceName: 'execute',
      traceMetadata: { node: 'execute', provider: 'openai', model: config.model },
      traceTags: ['shipyard', 'execute', 'openai'],
    });

    addChatCompletionUsage(usageAcc, completion.usage);

    const choice = completion.choices[0];
    if (!choice) {
      break;
    }

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const editsBefore = newEdits.length;
      await appendOpenAiToolTurn(
        conversation,
        msg,
        toolCalls,
        (name, input) => dispatchTool(name, input, hooks, overlay),
        {
          unsupportedToolMessage: 'Unsupported tool call type for Shipyard',
        },
      );

      if (newEdits.length === editsBefore) {
        noEditToolRounds += 1;
      } else {
        noEditToolRounds = 0;
      }

      if (noEditToolRounds >= MAX_NO_EDIT_TOOL_ROUNDS) {
        const failedSteps = updatedSteps.map((s, i) =>
          i === state.currentStepIndex ? { ...s, status: 'failed' as const } : s,
        );
        newMessages.push({
          role: 'assistant',
          content:
            `[Watchdog] Execution stalled: ${MAX_NO_EDIT_TOOL_ROUNDS} consecutive tool rounds without file edits. ` +
            'Replanning with tighter scope constraints.',
        });
        const snapshotJson = overlay.dirty
          ? JSON.stringify(
              Object.fromEntries(overlay.trackedFiles().map((f) => [f, ''])),
            )
          : state.fileOverlaySnapshots ?? null;
        return {
          phase: 'verifying',
          steps: failedSteps,
          fileEdits: newEdits,
          toolCallHistory: newHistory,
          messages: newMessages,
          tokenUsage: { input: usageAcc.input, output: usageAcc.output },
          fileOverlaySnapshots: snapshotJson,
          reviewFeedback:
            'Execution stalled with repeated tool calls and no file edits. Replan with stricter file targeting and complete the edit in one pass.',
        };
      }
      continue;
    }

    const textContent = assistantTextContent(msg);
    if (textContent.trim()) emitTextChunk('execute', textContent);
    const isExplicitComplete = textContent.includes('STEP_COMPLETE');
    const isStopNoTools = choice.finish_reason === 'stop';
    if (isExplicitComplete || isStopNoTools) {
      const finalSteps = updatedSteps.map((s, i) =>
        i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
      );
      return buildReturn(textContent, finalSteps);
    }

    newMessages.push({ role: 'assistant', content: textContent });
    break;
  }

  const finalSteps = updatedSteps.map((s, i) =>
    i === state.currentStepIndex ? { ...s, status: 'done' as const } : s,
  );

  const tailSnapshotJson = overlay.dirty
    ? JSON.stringify(
        Object.fromEntries(overlay.trackedFiles().map((f) => [f, ''])),
      )
    : state.fileOverlaySnapshots ?? null;

  return {
    phase: 'verifying',
    steps: finalSteps,
    fileEdits: newEdits,
    toolCallHistory: newHistory,
    messages: newMessages,
    tokenUsage: { input: usageAcc.input, output: usageAcc.output },
    fileOverlaySnapshots: tailSnapshotJson,
  };
}
