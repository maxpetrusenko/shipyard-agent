import type Anthropic from '@anthropic-ai/sdk';
import { CACHE_CONTROL } from '../config/client.js';
import { TOOL_RESULT_MAX_CHARS } from '../constants/limits.js';

/**
 * Run tool_use blocks and build Anthropic tool_result params with cache breakpoint on last result.
 */
export async function dispatchAnthropicToolBlocks(
  toolBlocks: Anthropic.ToolUseBlock[],
  dispatchOne: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const toolResults: Anthropic.ToolResultBlockParam[] = [];
  for (const tb of toolBlocks) {
    const result = await dispatchOne(tb.name, tb.input as Record<string, unknown>);
    toolResults.push({
      type: 'tool_result',
      tool_use_id: tb.id,
      content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS),
    });
  }
  if (toolResults.length > 0) {
    toolResults[toolResults.length - 1]!.cache_control = CACHE_CONTROL;
  }
  return toolResults;
}

/**
 * Anthropic allows at most 4 cache-control blocks per request.
 * Tool loops keep prior tool results in `messages`, so clear their markers
 * before the next round and let only the latest tool_result batch stay cached.
 */
export function stripToolResultCacheControls(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return message;
    }

    let changed = false;
    const content = message.content.map((block) => {
      if (block.type !== 'tool_result' || block.cache_control === undefined) {
        return block;
      }

      changed = true;
      const { cache_control: _cacheControl, ...rest } = block;
      return rest;
    });

    return changed ? { ...message, content } : message;
  });
}
