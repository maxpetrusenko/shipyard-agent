/**
 * Model routing policy.
 *
 * Opus 4.6 for planning/review (higher reasoning).
 * Sonnet 4.6 for coding/verification (speed + cost).
 */

export interface ModelConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export const MODEL_CONFIGS = {
  planning: {
    model: 'claude-opus-4-6',
    maxTokens: 16384,
    temperature: 0.3,
  },
  coding: {
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 8192,
    temperature: 0.2,
  },
  review: {
    model: 'claude-opus-4-6',
    maxTokens: 4096,
    temperature: 0.2,
  },
  verification: {
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 2048,
    temperature: 0.0,
  },
  summary: {
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 2048,
    temperature: 0.3,
  },
} as const satisfies Record<string, ModelConfig>;

export type ModelRole = keyof typeof MODEL_CONFIGS;

export function getModelConfig(role: ModelRole): ModelConfig {
  return MODEL_CONFIGS[role];
}

// ---------------------------------------------------------------------------
// Cost rates (USD per token)
// ---------------------------------------------------------------------------

/** Per-token cost rates by model (input/output in USD). */
const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':             { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-5-20250929':  { input: 3 / 1_000_000,  output: 15 / 1_000_000 },
};

/**
 * Estimate USD cost for a given model + token counts.
 * Returns 0 for unknown models.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = COST_RATES[model];
  if (!rate) return 0;
  return inputTokens * rate.input + outputTokens * rate.output;
}
