/**
 * Map Anthropic tool definitions to OpenAI Chat Completions function tools.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';

export function anthropicToolSchemasToOpenAi(
  tools: Anthropic.Tool[],
): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as OpenAI.FunctionParameters,
    },
  }));
}
