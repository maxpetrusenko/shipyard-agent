import { extractCacheMetrics } from '../config/messages-create.js';
import type Anthropic from '@anthropic-ai/sdk';

export class TokenAccumulator {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;

  constructor(seed?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheCreation?: number;
  }) {
    this.input = seed?.input ?? 0;
    this.output = seed?.output ?? 0;
    this.cacheRead = seed?.cacheRead ?? 0;
    this.cacheCreation = seed?.cacheCreation ?? 0;
  }

  addAnthropicRound(response: Anthropic.Message): void {
    this.input += response.usage.input_tokens;
    this.output += response.usage.output_tokens;
    const cm = extractCacheMetrics(response);
    this.cacheRead += cm.cacheRead;
    this.cacheCreation += cm.cacheCreation;
  }

  snapshot(): {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  } {
    return {
      input: this.input,
      output: this.output,
      cacheRead: this.cacheRead,
      cacheCreation: this.cacheCreation,
    };
  }
}
