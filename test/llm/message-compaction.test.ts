import { describe, it, expect, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  compactAnthropicMessages,
  estimateAnthropicMessageChars,
} from '../../src/llm/message-compaction.js';
import { OPS } from '../../src/server/ops.js';

describe('message-compaction', () => {
  beforeEach(() => {
    OPS.reset();
  });

  it('estimates chars for string and block messages', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'tool reply' },
          { type: 'tool_use', id: '1', name: 'grep', input: { q: 'x' } },
        ],
      },
    ];

    const chars = estimateAnthropicMessageChars(messages);
    expect(chars).toBeGreaterThanOrEqual(10);
  });

  it('does not compact when under budget', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];

    const out = compactAnthropicMessages(messages, {
      maxChars: 500,
      preserveRecentMessages: 2,
    });

    expect(out.compacted).toBe(false);
    expect(out.messages).toEqual(messages);
  });

  it('compacts middle history while preserving first user and recent turns', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'initial instruction' },
      { role: 'assistant', content: 'step 1 done' },
      { role: 'user', content: 'follow up 1' },
      { role: 'assistant', content: 'step 2 done' },
      { role: 'user', content: 'follow up 2' },
      { role: 'assistant', content: 'step 3 done' },
      { role: 'user', content: 'follow up 3' },
      { role: 'assistant', content: 'step 4 done' },
    ];

    const out = compactAnthropicMessages(messages, {
      maxChars: 40,
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
    expect(counters['shipyard.llm.compaction.anthropic_applied']?.value ?? 0).toBe(1);
    expect(counters['shipyard.llm.compaction.messages_dropped']?.value ?? 0).toBeGreaterThan(0);
    expect(counters['shipyard.llm.compaction.chars_saved']?.value ?? 0).toBeGreaterThanOrEqual(0);
  });
});
