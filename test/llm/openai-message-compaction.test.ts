import { describe, it, expect, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import {
  compactOpenAiMessages,
  estimateOpenAiMessageChars,
} from '../../src/llm/openai-message-compaction.js';
import { OPS } from '../../src/server/ops.js';

describe('openai-message-compaction', () => {
  beforeEach(() => {
    OPS.reset();
  });

  it('estimates chars for content-bearing messages', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'done' },
    ];
    expect(estimateOpenAiMessageChars(messages)).toBeGreaterThan(0);
  });

  it('keeps messages unchanged under budget', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'done' },
    ];

    const out = compactOpenAiMessages(messages, {
      maxChars: 1_000,
      preserveRecentMessages: 2,
    });

    expect(out.compacted).toBe(false);
    expect(out.messages).toEqual(messages);
  });

  it('compacts older middle messages and preserves recent tail', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'initial task' },
      { role: 'assistant', content: 'analysis 1' },
      { role: 'user', content: 'follow up 1' },
      { role: 'assistant', content: 'analysis 2' },
      { role: 'user', content: 'follow up 2' },
      { role: 'assistant', content: 'analysis 3' },
    ];

    const out = compactOpenAiMessages(messages, {
      maxChars: 30,
      preserveRecentMessages: 2,
    });

    expect(out.compacted).toBe(true);
    expect(out.messages[0]).toEqual(messages[0]);
    expect(out.messages.at(-1)).toEqual(messages.at(-1));
    expect(out.messages.some((m) =>
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.includes('Compacted conversation context'),
    )).toBe(true);
    const counters = OPS.snapshot();
    expect(counters['shipyard.llm.compaction.openai_applied']?.value ?? 0).toBe(1);
    expect(counters['shipyard.llm.compaction.messages_dropped']?.value ?? 0).toBeGreaterThan(0);
    expect(counters['shipyard.llm.compaction.chars_saved']?.value ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('does not orphan tool results when recent history starts mid tool turn', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'load test task 0' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_read',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_read',
        content: '{"ok":true}',
      },
      { role: 'assistant', content: 'Read the file.' },
      { role: 'assistant', content: 'Next step.' },
    ];

    const out = compactOpenAiMessages(messages, {
      maxChars: 20,
      preserveRecentMessages: 3,
    });

    const toolIndex = out.messages.findIndex((message) => message.role === 'tool');
    expect(toolIndex).toBeGreaterThan(0);
    const preceding = out.messages[toolIndex - 1];
    expect(preceding).toMatchObject({
      role: 'assistant',
      tool_calls: [
        expect.objectContaining({ id: 'call_read' }),
      ],
    });
  });

  it('drops orphaned tool messages even when history stays under budget', () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: 'load test task 0' },
      {
        role: 'tool',
        tool_call_id: 'call_orphan',
        content: '{"ok":true}',
      },
      { role: 'assistant', content: 'done' },
    ];

    const out = compactOpenAiMessages(messages, {
      maxChars: 10_000,
      preserveRecentMessages: 3,
    });

    expect(out.compacted).toBe(false);
    expect(out.messages).toEqual([
      messages[0],
      messages[2],
    ]);
  });
});
