import type Anthropic from '@anthropic-ai/sdk';
import { OPS } from '../server/ops.js';

export interface MessageCompactionOptions {
  maxChars: number;
  preserveRecentMessages?: number;
}

export interface MessageCompactionResult {
  messages: Anthropic.MessageParam[];
  compacted: boolean;
  beforeChars: number;
  afterChars: number;
  droppedMessages: number;
}

function blockText(block: Anthropic.ContentBlockParam): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'tool_use') {
    return `[tool_use ${block.name}] ${JSON.stringify(block.input ?? {})}`;
  }
  if (block.type === 'tool_result') {
    const content =
      typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((item) => {
              if (item.type === 'text') return item.text;
              if (item.type === 'image') return '[image]';
              return '[tool_result]';
            }).join(' ')
          : '[tool_result]';
    return `[tool_result ${block.tool_use_id}] ${content}`;
  }
  if (block.type === 'image') return '[image]';
  if (block.type === 'document') return '[document]';
  return '';
}

function messageText(message: Anthropic.MessageParam): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((block) => blockText(block)).join('\n');
  }
  return '';
}

export function estimateAnthropicMessageChars(
  messages: Anthropic.MessageParam[],
): number {
  let total = 0;
  for (const msg of messages) {
    total += (msg.role?.length ?? 0) + 1;
    total += messageText(msg).length;
  }
  return total;
}

function buildCompactionSummary(
  removed: Anthropic.MessageParam[],
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

export function compactAnthropicMessages(
  messages: Anthropic.MessageParam[],
  options: MessageCompactionOptions,
): MessageCompactionResult {
  const beforeChars = estimateAnthropicMessageChars(messages);
  const preserveRecentMessages = Math.max(1, options.preserveRecentMessages ?? 6);

  if (beforeChars <= options.maxChars || messages.length <= preserveRecentMessages + 1) {
    return {
      messages,
      compacted: false,
      beforeChars,
      afterChars: beforeChars,
      droppedMessages: 0,
    };
  }

  const firstUserIndex = messages.findIndex((m) => m.role === 'user');
  const keepFirst = firstUserIndex >= 0 ? messages[firstUserIndex] : messages[0];
  const recent = messages.slice(-preserveRecentMessages);
  const start = firstUserIndex >= 0 ? firstUserIndex + 1 : 1;
  const end = Math.max(start, messages.length - preserveRecentMessages);
  const removed = messages.slice(start, end);
  const removedChars = estimateAnthropicMessageChars(removed);

  const compacted: Anthropic.MessageParam[] = [];
  if (keepFirst) compacted.push(keepFirst);
  compacted.push({
    role: 'assistant',
    content: buildCompactionSummary(removed, removedChars),
  });
  compacted.push(...recent);

  const afterChars = estimateAnthropicMessageChars(compacted);
  OPS.increment('shipyard.llm.compaction.anthropic_applied');
  OPS.increment('shipyard.llm.compaction.messages_dropped', removed.length);
  OPS.increment(
    'shipyard.llm.compaction.chars_saved',
    Math.max(0, beforeChars - afterChars),
  );
  return {
    messages: compacted,
    compacted: true,
    beforeChars,
    afterChars,
    droppedMessages: removed.length,
  };
}
