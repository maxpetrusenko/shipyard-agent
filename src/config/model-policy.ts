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
    maxTokens: 4096,
    temperature: 0.3,
  },
  coding: {
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 8192,
    temperature: 0.2,
  },
  review: {
    model: 'claude-opus-4-6',
    maxTokens: 2048,
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
