import type Anthropic from '@anthropic-ai/sdk';

export function extractTextFromContentBlocks(
  content: Anthropic.ContentBlock[],
): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function extractToolUseBlocks(
  content: Anthropic.ContentBlock[],
): Anthropic.ToolUseBlock[] {
  return content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
}
