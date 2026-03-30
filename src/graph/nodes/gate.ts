/**
 * Entry gate: Q&A (direct reply, no plan/execute/verify) vs full coding pipeline.
 */

import Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import {
  getResolvedModelConfigFromState,
  isOpenAiModelId,
} from '../../config/model-policy.js';
import {
  getClient,
  wrapSystemPrompt,
  CACHE_CONTROL,
} from '../../config/client.js';
import {
  messagesCreate,
  extractCacheMetrics,
} from '../../config/messages-create.js';
import { completeTextForRole } from '../../llm/complete-text.js';
import { compactAnthropicMessages } from '../../llm/message-compaction.js';
import { compactOpenAiMessages } from '../../llm/openai-message-compaction.js';
import {
  buildContextBlock,
  type ShipyardStateType,
  type LLMMessage,
} from '../state.js';
import {
  looksLikeCodeRequest,
  tryArithmeticShortcut,
  tryChatShortcut,
} from '../intent.js';
import { tryCommandShortcut } from '../commands.js';
import { detectRepoTargetMismatch } from '../guards.js';

const CHAT_SYSTEM = `You are Shipyard. The user is in Q&A mode: they are not asking you to modify the repository in this turn.

Answer clearly. Give a brief line of reasoning when it helps (e.g. for math or logic), then the direct answer.
Do not invent file paths or claim you edited files. If they clearly need code changes in the project, end with one short line: say they should submit again with a concrete coding request (or turn off Chat-only mode if they are using it).`;

const CHAT_COMPACTION_MAX_CHARS = 100_000;
const CHAT_COMPACTION_PRESERVE_RECENT_MESSAGES = 8;

function buildUserContent(state: ShipyardStateType): string {
  const ctx = buildContextBlock(state.contexts);
  if (ctx) return `${ctx}\n\n---\n\n# Message\n${state.instruction}`;
  return state.instruction;
}

function appendUserTurn(
  messages: LLMMessage[],
  instruction: string,
): LLMMessage[] {
  const last = messages[messages.length - 1];
  if (
    last &&
    last.role === 'user' &&
    last.content.trim() === instruction.trim()
  ) {
    return [...messages];
  }
  return [...messages, { role: 'user', content: instruction }];
}

function anthropicContentToText(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      return '';
    })
    .join('');
}

function openAiContentToText(
  content: OpenAI.Chat.ChatCompletionMessageParam['content'],
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      return '';
    })
    .join('');
}

function anthropicHistoryToOpenAi(
  messages: Anthropic.MessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    return [{
      role: message.role,
      content: anthropicContentToText(message.content),
    }];
  });
}

function openAiHistoryToAnthropic(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Anthropic.MessageParam[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    return [{
      role: message.role,
      content: openAiContentToText(message.content),
    }];
  });
}

function chatCompactionNote(compacted: {
  beforeChars: number;
  afterChars: number;
  droppedMessages: number;
}): string {
  return `[Compaction] chat history compacted (${compacted.beforeChars} -> ${compacted.afterChars} chars, dropped ${compacted.droppedMessages} messages).`;
}

function compactChatHistory(
  history: Anthropic.MessageParam[],
  provider: 'anthropic' | 'openai',
): { history: Anthropic.MessageParam[]; note: string | null } {
  if (provider === 'openai') {
    const compacted = compactOpenAiMessages(anthropicHistoryToOpenAi(history), {
      maxChars: CHAT_COMPACTION_MAX_CHARS,
      preserveRecentMessages: CHAT_COMPACTION_PRESERVE_RECENT_MESSAGES,
    });
    return {
      history: openAiHistoryToAnthropic(compacted.messages),
      note: compacted.compacted ? chatCompactionNote(compacted) : null,
    };
  }

  const compacted = compactAnthropicMessages(history, {
    maxChars: CHAT_COMPACTION_MAX_CHARS,
    preserveRecentMessages: CHAT_COMPACTION_PRESERVE_RECENT_MESSAGES,
  });
  return {
    history: compacted.messages,
    note: compacted.compacted ? chatCompactionNote(compacted) : null,
  };
}

function validateSuppliedPlan(
  state: ShipyardStateType,
): { steps: ShipyardStateType['steps']; currentStepIndex: number } | { error: string } | null {
  if (state.steps.length === 0) return null;

  const seen = new Set<number>();
  const normalized = [] as ShipyardStateType['steps'];
  for (let index = 0; index < state.steps.length; index += 1) {
    const step = state.steps[index];
    const stepIndex = typeof step?.index === 'number' ? step.index : index;
    const description = typeof step?.description === 'string' ? step.description.trim() : '';
    const files = Array.isArray(step?.files)
      ? step.files.filter((file): file is string => typeof file === 'string').map((file) => file.trim()).filter(Boolean)
      : [];
    if (!description) {
      return { error: `Supplied execution plan step ${index + 1} is missing a description.` };
    }
    if (seen.has(stepIndex)) {
      return { error: `Supplied execution plan has duplicate step index ${stepIndex}.` };
    }
    seen.add(stepIndex);
    normalized.push({
      index: stepIndex,
      description,
      files,
      status: 'pending',
    });
  }

  if (normalized.length === 0) {
    return { error: 'Supplied execution plan must include at least one step.' };
  }

  normalized.sort((a, b) => a.index - b.index);
  return {
    steps: normalized.map((step, index) => ({ ...step, index })),
    currentStepIndex: 0,
  };
}

async function directChatResponse(
  state: ShipyardStateType,
): Promise<{
  messages: LLMMessage[];
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
}> {
  const shortcut = tryChatShortcut(state.instruction);
  if (shortcut !== null) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    return {
      messages: [
        ...withUser,
        { role: 'assistant', content: shortcut },
      ],
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
  }

  const config = getResolvedModelConfigFromState('chat', state);
  const userLine = buildUserContent(state);

  const prior = state.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );
  const rawHistory: Anthropic.MessageParam[] = appendUserTurn(prior, userLine).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const provider = isOpenAiModelId(config.model) ? 'openai' : 'anthropic';
  const { history, note } = compactChatHistory(rawHistory, provider);
  const withUser = appendUserTurn(state.messages, state.instruction);

  if (isOpenAiModelId(config.model)) {
    const { text, inputTokens, outputTokens, cacheRead, cacheCreation } = await completeTextForRole(
      state,
      'chat',
      CHAT_SYSTEM,
      history,
      { liveNode: 'chat' },
    );
    const newMessages: LLMMessage[] = [
      ...withUser,
      ...(note ? [{ role: 'assistant' as const, content: note }] : []),
      { role: 'assistant', content: text },
    ];
    return {
      messages: newMessages,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheCreation,
    };
  }

  const anthropic = getClient();

  // Cache conversation prefix: mark the last prior user message so the
  // entire conversation history up to it is cached across exchanges.
  if (history.length >= 3) {
    for (let i = history.length - 2; i >= 0; i--) {
      const msg = history[i]!;
      if (msg.role === 'user' && typeof msg.content === 'string') {
        history[i] = {
          role: 'user',
          content: [
            {
              type: 'text' as const,
              text: msg.content,
              cache_control: CACHE_CONTROL,
            },
          ],
        };
        break;
      }
    }
  }

  const response = await messagesCreate(anthropic, {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: wrapSystemPrompt(CHAT_SYSTEM),
    messages: history,
  }, {
    liveNode: 'chat',
    traceName: 'chat',
    traceMetadata: { node: 'chat', provider: 'anthropic', model: config.model },
    traceTags: ['shipyard', 'chat', 'anthropic'],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const newMessages: LLMMessage[] = [
    ...withUser,
    ...(note ? [{ role: 'assistant' as const, content: note }] : []),
    { role: 'assistant', content: text },
  ];

  const cm = extractCacheMetrics(response);
  return {
    messages: newMessages,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheRead: cm.cacheRead,
    cacheCreation: cm.cacheCreation,
  };
}

export async function gateNode(
  state: ShipyardStateType,
): Promise<Partial<ShipyardStateType>> {
  const mode = state.runMode ?? 'auto';
  const baseTokens = state.tokenUsage ?? { input: 0, output: 0 };
  const suppliedPlan = validateSuppliedPlan(state);
  const commandShortcut = await tryCommandShortcut(state.instruction);
  if (commandShortcut !== null) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    return {
      gateRoute: 'end',
      phase: 'done',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      messages: [
        ...withUser,
        { role: 'assistant', content: commandShortcut },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  const activeWorkDir = state.workDir?.trim() || process.cwd();
  const repoMismatch = detectRepoTargetMismatch(state.instruction, activeWorkDir);
  if (repoMismatch) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    const mismatchMsg =
      `Repo target mismatch: instruction targets "${repoMismatch.targetRepo}" but active workdir is "${repoMismatch.activeRepo}". ` +
      `Switch Shipyard to the target project/workdir, then retry.`;
    return {
      gateRoute: 'end',
      phase: 'error',
      error: mismatchMsg,
      messages: [
        ...withUser,
        { role: 'assistant', content: mismatchMsg },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  if (suppliedPlan && 'error' in suppliedPlan) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    return {
      gateRoute: 'end',
      phase: 'error',
      error: suppliedPlan.error,
      messages: [
        ...withUser,
        { role: 'assistant', content: suppliedPlan.error },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  if (suppliedPlan) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    const gateRoute = !state.forceSequential && suppliedPlan.steps.length > 0
      ? 'coordinate'
      : 'execute';
    return {
      gateRoute,
      phase: 'executing',
      steps: suppliedPlan.steps,
      currentStepIndex: suppliedPlan.currentStepIndex,
      currentStepEditBaseline: state.fileEdits.length,
      messages: [
        ...withUser,
        { role: 'assistant', content: `[Gate] Using supplied execution plan (${suppliedPlan.steps.length} steps).` },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  if (mode === 'code') {
    return {
      gateRoute: 'plan',
      phase: 'planning',
    };
  }

  if (mode === 'chat') {
    const r = await directChatResponse(state);
    return {
      gateRoute: 'end',
      phase: 'done',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      messages: r.messages,
      tokenUsage: {
        input: baseTokens.input + r.inputTokens,
        output: baseTokens.output + r.outputTokens,
        cacheRead: (baseTokens.cacheRead ?? 0) + r.cacheRead,
        cacheCreation: (baseTokens.cacheCreation ?? 0) + r.cacheCreation,
      },
      modelHint: 'sonnet',
    };
  }

  // auto
  const shortcut = tryArithmeticShortcut(state.instruction);
  if (shortcut !== null) {
    const reply = `Reasoning: arithmetic only, no repo work needed.\n\nAnswer: ${shortcut}`;
    const withUser = appendUserTurn(state.messages, state.instruction);
    return {
      gateRoute: 'end',
      phase: 'done',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      messages: [
        ...withUser,
        { role: 'assistant', content: reply },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  const chatShortcut = tryChatShortcut(state.instruction);
  if (chatShortcut !== null) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    return {
      gateRoute: 'end',
      phase: 'done',
      steps: [],
      currentStepIndex: 0,
      fileEdits: [],
      toolCallHistory: [],
      verificationResult: null,
      reviewDecision: null,
      reviewFeedback: null,
      messages: [
        ...withUser,
        { role: 'assistant', content: chatShortcut },
      ],
      tokenUsage: baseTokens,
      modelHint: 'sonnet',
    };
  }

  if (looksLikeCodeRequest(state.instruction)) {
    return {
      gateRoute: 'plan',
      phase: 'planning',
    };
  }

  const r = await directChatResponse(state);
  return {
    gateRoute: 'end',
    phase: 'done',
    steps: [],
    currentStepIndex: 0,
    fileEdits: [],
    toolCallHistory: [],
    verificationResult: null,
    reviewDecision: null,
    reviewFeedback: null,
    messages: r.messages,
    tokenUsage: {
      input: baseTokens.input + r.inputTokens,
      output: baseTokens.output + r.outputTokens,
      cacheRead: (baseTokens.cacheRead ?? 0) + r.cacheRead,
      cacheCreation: (baseTokens.cacheCreation ?? 0) + r.cacheCreation,
    },
    modelHint: 'sonnet',
  };
}
