import type OpenAI from 'openai';
import { OPS } from '../server/ops.js';

export interface OpenAiMessageCompactionOptions {
  maxChars: number;
  preserveRecentMessages?: number;
}

export interface OpenAiMessageCompactionResult {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  compacted: boolean;
  beforeChars: number;
  afterChars: number;
  droppedMessages: number;
}

interface SanitizedOpenAiMessages {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  droppedMessages: number;
}

function messageText(message: OpenAI.Chat.ChatCompletionMessageParam): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === 'text') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

function getAssistantToolCallIds(
  message: OpenAI.Chat.ChatCompletionMessageParam,
): string[] {
  if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
    return [];
  }
  return message.tool_calls
    .map((toolCall) => toolCall.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function sanitizeOpenAiMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): SanitizedOpenAiMessages {
  const sanitized: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  let droppedMessages = 0;
  let pendingTurn: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  let pendingToolIds: Set<string> | null = null;

  const flushPendingTurn = (complete: boolean): void => {
    if (pendingTurn.length === 0) return;
    if (complete) {
      sanitized.push(...pendingTurn);
    } else {
      droppedMessages += pendingTurn.length;
    }
    pendingTurn = [];
    pendingToolIds = null;
  };

  for (const message of messages) {
    if (pendingToolIds) {
      if (message.role === 'tool') {
        const toolCallId = message.tool_call_id;
        if (!toolCallId || !pendingToolIds.has(toolCallId)) {
          droppedMessages += 1;
          continue;
        }
        pendingTurn.push(message);
        pendingToolIds.delete(toolCallId);
        if (pendingToolIds.size === 0) {
          flushPendingTurn(true);
        }
        continue;
      }

      flushPendingTurn(false);
    }

    if (message.role === 'tool') {
      droppedMessages += 1;
      continue;
    }

    const toolCallIds = getAssistantToolCallIds(message);
    if (toolCallIds.length > 0) {
      pendingTurn = [message];
      pendingToolIds = new Set(toolCallIds);
      continue;
    }

    sanitized.push(message);
  }

  flushPendingTurn(false);

  return { messages: sanitized, droppedMessages };
}

function groupOpenAiMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): OpenAI.Chat.ChatCompletionMessageParam[][] {
  const groups: OpenAI.Chat.ChatCompletionMessageParam[][] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    const toolCallIds = getAssistantToolCallIds(message);
    if (toolCallIds.length === 0) {
      groups.push([message]);
      continue;
    }

    const group = [message];
    for (let j = i + 1; j < messages.length; j += 1) {
      const next = messages[j]!;
      if (next.role !== 'tool') break;
      group.push(next);
      i = j;
    }
    groups.push(group);
  }

  return groups;
}

export function estimateOpenAiMessageChars(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): number {
  let total = 0;
  for (const msg of messages) {
    total += msg.role.length + 1;
    total += messageText(msg).length;
  }
  return total;
}

function compactionSummary(
  removed: OpenAI.Chat.ChatCompletionMessageParam[],
  removedChars: number,
): string {
  const snippets: string[] = [];
  for (const msg of removed) {
    const txt = messageText(msg).replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    snippets.push(`${msg.role}: ${txt.slice(0, 140)}`);
    if (snippets.length >= 5) break;
  }
  const header =
    `Compacted conversation context: removed ${removed.length} older messages (~${removedChars} chars).`;
  if (snippets.length === 0) return header;
  return `${header}\nHighlights:\n- ${snippets.join('\n- ')}`;
}

export function compactOpenAiMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: OpenAiMessageCompactionOptions,
): OpenAiMessageCompactionResult {
  const beforeChars = estimateOpenAiMessageChars(messages);
  const sanitized = sanitizeOpenAiMessages(messages);
  const sanitizedChars = estimateOpenAiMessageChars(sanitized.messages);
  const preserveRecentMessages = Math.max(1, options.preserveRecentMessages ?? 6);
  const groups = groupOpenAiMessages(sanitized.messages);

  if (
    sanitizedChars <= options.maxChars ||
    groups.length <= preserveRecentMessages + 1
  ) {
    return {
      messages: sanitized.messages,
      compacted: false,
      beforeChars,
      afterChars: sanitizedChars,
      droppedMessages: sanitized.droppedMessages,
    };
  }

  const firstUserIndex = groups.findIndex((group) => group[0]?.role === 'user');
  const keepFirst = firstUserIndex >= 0 ? groups[firstUserIndex]! : groups[0]!;
  const start = firstUserIndex >= 0 ? firstUserIndex + 1 : 1;
  const end = Math.max(start, groups.length - preserveRecentMessages);
  const removed = groups.slice(start, end).flat();
  if (removed.length === 0) {
    return {
      messages: sanitized.messages,
      compacted: false,
      beforeChars,
      afterChars: sanitizedChars,
      droppedMessages: sanitized.droppedMessages,
    };
  }
  const recent = groups.slice(-preserveRecentMessages).flat();
  const removedChars = estimateOpenAiMessageChars(removed);

  const compacted: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  compacted.push(...keepFirst);
  compacted.push({
    role: 'assistant',
    content: compactionSummary(removed, removedChars),
  });
  compacted.push(...recent);

  const afterChars = estimateOpenAiMessageChars(compacted);
  OPS.increment('shipyard.llm.compaction.openai_applied');
  OPS.increment(
    'shipyard.llm.compaction.messages_dropped',
    removed.length + sanitized.droppedMessages,
  );
  OPS.increment(
    'shipyard.llm.compaction.chars_saved',
    Math.max(0, beforeChars - afterChars),
  );
  return {
    messages: compacted,
    compacted: true,
    beforeChars,
    afterChars,
    droppedMessages: removed.length + sanitized.droppedMessages,
  };
}
