/**
 * Entry gate: Q&A (direct reply, no plan/execute/verify) vs full coding pipeline.
 */

import Anthropic from '@anthropic-ai/sdk';
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
import { WORK_DIR } from '../../config/work-dir.js';

const CHAT_SYSTEM = `You are Shipyard. The user is in Q&A mode: they are not asking you to modify the repository in this turn.

Answer clearly. Give a brief line of reasoning when it helps (e.g. for math or logic), then the direct answer.
Do not invent file paths or claim you edited files. If they clearly need code changes in the project, end with one short line: say they should submit again with a concrete coding request (or turn off Chat-only mode if they are using it).`;

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
  const history: Anthropic.MessageParam[] = appendUserTurn(prior, userLine).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  if (isOpenAiModelId(config.model)) {
    const { text, inputTokens, outputTokens, cacheRead, cacheCreation } = await completeTextForRole(
      state,
      'chat',
      CHAT_SYSTEM,
      history,
      { liveNode: 'chat' },
    );
    const withUser = appendUserTurn(state.messages, state.instruction);
    const newMessages: LLMMessage[] = [
      ...withUser,
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
    ...appendUserTurn(state.messages, state.instruction),
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

  const repoMismatch = detectRepoTargetMismatch(state.instruction, WORK_DIR);
  if (repoMismatch) {
    const withUser = appendUserTurn(state.messages, state.instruction);
    const mismatchMsg =
      `Repo target mismatch: instruction targets "${repoMismatch.targetRepo}" but active workdir is "${repoMismatch.activeRepo}". ` +
      `Switch SHIPYARD_WORK_DIR to the target repo, then retry.`;
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
