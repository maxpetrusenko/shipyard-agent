/**
 * Model routing policy.
 *
 * Defaults favor OpenAI so "Model: (none)" in chat still runs on OpenAI.
 */

export interface ModelConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

const MODEL_ID_ALIASES: Record<string, string> = {
  'gpt-5-mini': 'gpt-5.4-mini',
  'gpt-5-nano': 'gpt-5.4-nano',
  'gpt-5.1-codex': 'gpt-5.4',
  'gpt-5.3-codex': 'gpt-5.4',
  'agent 5.1': 'gpt-5.4',
  'agent 5.3': 'gpt-5.4',
  'agent-5.1': 'gpt-5.4',
  'agent-5.3': 'gpt-5.4',
  'agent5.1': 'gpt-5.4',
  'agent5.3': 'gpt-5.4',
};

export function canonicalizeModelId(
  model: string | null | undefined,
): string | null | undefined {
  if (model == null) return model;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  return MODEL_ID_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function canonicalizeModelOverrides(
  modelOverrides: Partial<Record<ModelRole, string>> | null | undefined,
): Partial<Record<ModelRole, string>> | null | undefined {
  if (!modelOverrides) return modelOverrides;
  const next: Partial<Record<ModelRole, string>> = {};
  for (const [role, model] of Object.entries(modelOverrides)) {
    const canonical = canonicalizeModelId(model);
    if (canonical) next[role as ModelRole] = canonical;
  }
  return next;
}

/** Models that require temperature=1 (extended thinking). */
const TEMP_1_ONLY_MODELS = new Set([
  'claude-opus-4-6',
]);

/** Clamp temperature to 1 for models that require it. */
function clampTemp(config: ModelConfig): ModelConfig {
  if (TEMP_1_ONLY_MODELS.has(config.model) && config.temperature !== 1) {
    return { ...config, temperature: 1 };
  }
  return config;
}

export const MODEL_CONFIGS = {
  planning: {
    model: 'gpt-5.4',
    maxTokens: 16384,
    temperature: 0.3,
  },
  coding: {
    model: 'gpt-5.4-mini',
    maxTokens: 8192,
    temperature: 0.2,
  },
  review: {
    model: 'gpt-5.4',
    maxTokens: 4096,
    temperature: 0.2,
  },
  verification: {
    model: 'gpt-5.4-mini',
    maxTokens: 2048,
    temperature: 0.0,
  },
  summary: {
    model: 'gpt-5.4-mini',
    maxTokens: 2048,
    temperature: 0.3,
  },
  /** CHAT vs CODE routing in auto mode (keep tiny). */
  intent: {
    model: 'gpt-5.4-mini',
    maxTokens: 16,
    temperature: 0,
  },
  /** Direct Q&A replies (no tools). */
  chat: {
    model: 'gpt-5.4-mini',
    maxTokens: 2048,
    temperature: 0.2,
  },
} as const satisfies Record<string, ModelConfig>;

export type ModelRole = keyof typeof MODEL_CONFIGS;

const OPENAI_CHAT_MODEL_ALLOWLIST = new Set([
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
]);

function isOpenAiFamilyModelId(model: string): boolean {
  const normalized = (canonicalizeModelId(model) ?? model).trim().toLowerCase();
  return normalized.startsWith('gpt-') || /^o[1-4](?:$|[-.])/.test(normalized);
}

function normalizeResolvedModel(role: ModelRole, model: string): string {
  const canonical = canonicalizeModelId(model) ?? model;
  const normalized = canonical.trim().toLowerCase();
  if (!isOpenAiFamilyModelId(normalized)) return canonical;
  if (OPENAI_CHAT_MODEL_ALLOWLIST.has(normalized)) return canonical;
  console.warn('[model-policy] Unknown model, falling back to default:', model);
  return FAMILY_DEFAULT_MODELS.openai[role];
}

/** Optional per-role model id (e.g. Haiku for cheap smoke tests). Unset = use table defaults. */
const MODEL_ENV_KEYS: Record<ModelRole, string> = {
  planning: 'SHIPYARD_PLANNING_MODEL',
  coding: 'SHIPYARD_CODING_MODEL',
  review: 'SHIPYARD_REVIEW_MODEL',
  verification: 'SHIPYARD_VERIFICATION_MODEL',
  summary: 'SHIPYARD_SUMMARY_MODEL',
  intent: 'SHIPYARD_INTENT_MODEL',
  chat: 'SHIPYARD_CHAT_MODEL',
};

export function getModelConfig(role: ModelRole): ModelConfig {
  const base = MODEL_CONFIGS[role];
  const fromEnv = canonicalizeModelId(process.env[MODEL_ENV_KEYS[role]]);
  if (!fromEnv) return clampTemp(base);
  return clampTemp({ ...base, model: normalizeResolvedModel(role, fromEnv) });
}

// ---------------------------------------------------------------------------
// Cost rates (USD per token)
// ---------------------------------------------------------------------------

/** Per-token cost rates by model (input/output in USD). */
const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  'claude-haiku-4-5': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  'claude-3-5-haiku-20241022': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  /** OpenAI (platform pricing, per 1M tokens). */
  'gpt-5.4': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  'gpt-5.4-mini': { input: 0.25 / 1_000_000, output: 2 / 1_000_000 },
  'gpt-5.4-nano': { input: 0.1 / 1_000_000, output: 0.4 / 1_000_000 },
};

/** Provider family presets (per-stage model ids). */
export type ModelFamily = 'anthropic' | 'openai';

const FAMILY_DEFAULT_MODELS: Record<
  ModelFamily,
  Record<ModelRole, string>
> = {
  anthropic: {
    planning: 'claude-sonnet-4-5-20250929',
    coding: 'claude-haiku-4-5',
    review: 'claude-sonnet-4-5-20250929',
    verification: 'claude-sonnet-4-5-20250929',
    summary: 'claude-sonnet-4-5-20250929',
    intent: 'claude-haiku-4-5',
    chat: 'claude-sonnet-4-5-20250929',
  },
  openai: {
    planning: 'gpt-5.4',
    coding: 'gpt-5.4-mini',
    review: 'gpt-5.4',
    verification: 'gpt-5.4-mini',
    summary: 'gpt-5.4-mini',
    intent: 'gpt-5.4-mini',
    chat: 'gpt-5.4-mini',
  },
};

export interface ModelResolutionOpts {
  /** When set, overrides env defaults for every stage unless a per-stage override exists. */
  modelFamily?: ModelFamily | null;
  /** Per-stage model id overrides (from API or settings UI). */
  modelOverrides?: Partial<Record<ModelRole, string>> | null;
  /** Single per-run model override applied when no per-stage override exists. */
  legacyCodingOverride?: string | null;
}

/**
 * Effective model config for a role: per-stage override, single run override,
 * then env `SHIPYARD_*_MODEL`, then family preset, then table default.
 */
export function getResolvedModelConfig(
  role: ModelRole,
  opts: ModelResolutionOpts,
): ModelConfig {
  const base = MODEL_CONFIGS[role];
  const stageOverride = canonicalizeModelId(opts.modelOverrides?.[role]);
  if (stageOverride) {
    return clampTemp({ ...base, model: normalizeResolvedModel(role, stageOverride) });
  }
  const legacyOverride = canonicalizeModelId(opts.legacyCodingOverride);
  if (legacyOverride) {
    return clampTemp({ ...base, model: normalizeResolvedModel(role, legacyOverride) });
  }
  const fromEnv = canonicalizeModelId(process.env[MODEL_ENV_KEYS[role]]);
  if (fromEnv) {
    return clampTemp({ ...base, model: normalizeResolvedModel(role, fromEnv) });
  }
  if (opts.modelFamily === 'anthropic' || opts.modelFamily === 'openai') {
    return clampTemp({
      ...base,
      model: normalizeResolvedModel(role, FAMILY_DEFAULT_MODELS[opts.modelFamily][role]),
    });
  }
  return getModelConfig(role);
}

/** Shorthand for graph nodes that have full state. */
export function getResolvedModelConfigFromState(
  role: ModelRole,
  state: {
    modelFamily?: ModelFamily | null;
    modelOverrides?: Partial<Record<ModelRole, string>> | Record<string, string> | null;
    modelOverride?: string | null;
  },
): ModelConfig {
  return getResolvedModelConfig(role, {
    modelFamily: state.modelFamily ?? null,
    modelOverrides:
      canonicalizeModelOverrides(
        (state.modelOverrides as Partial<Record<ModelRole, string>> | null) ??
          null,
      ) ?? null,
    legacyCodingOverride: canonicalizeModelId(state.modelOverride) ?? null,
  });
}

/** True when the execute node should use the OpenAI SDK (Chat Completions + tools). */
export function isOpenAiModelId(model: string): boolean {
  return isOpenAiFamilyModelId(model);
}

/** Same-provider fallback model for transient provider-level issues (e.g. 429). */
export function getRateLimitFallbackModel(
  role: ModelRole,
  currentModel: string,
): string {
  const model = (canonicalizeModelId(currentModel) ?? currentModel)
    .trim()
    .toLowerCase();
  if (isOpenAiModelId(model)) {
    if (model === 'gpt-5.4-mini') return 'gpt-5.4';
    if (model === 'gpt-5.4-nano') return 'gpt-5.4-mini';
    return 'gpt-5.4-mini';
  }
  if (model.includes('haiku')) return 'claude-sonnet-4-5-20250929';
  if (model.includes('sonnet')) return 'claude-opus-4-6';
  return FAMILY_DEFAULT_MODELS.anthropic[role];
}

/** Model presets available in the dashboard model selector. */
export const MODEL_PRESETS = [
  { id: 'default', label: 'Default (GPT-5.4 Mini)', model: null },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4 (OpenAI)',
    model: 'gpt-5.4',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini (OpenAI)',
    model: 'gpt-5.4-mini',
  },
] as const;

/** All model ids selectable in Settings (per-stage overrides). */
export const MODEL_CATALOG: { id: string; label: string }[] = [
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
];

/**
 * Estimate USD cost for a given model + token counts.
 *
 * When cache metrics are provided, applies Anthropic's cache pricing:
 * - Cache reads: 10% of base input price (90% discount)
 * - Cache writes: 125% of base input price (25% premium)
 * - Uncached input: full base input price
 *
 * `inputTokens` from the API represents non-cache-read tokens.
 * `cacheRead` tokens are charged at the discounted rate.
 *
 * Returns null for unknown models (not in COST_RATES).
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead = 0,
  cacheCreation = 0,
): number | null {
  const rate = COST_RATES[model];
  if (!rate) return null;

  const uncachedInput = Math.max(0, inputTokens - cacheCreation);
  const inputCost =
    uncachedInput * rate.input +
    cacheCreation * rate.input * 1.25 +
    cacheRead * rate.input * 0.1;

  return inputCost + outputTokens * rate.output;
}
