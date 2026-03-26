import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  estimateCost,
  getModelConfig,
  getResolvedModelConfig,
  isOpenAiModelId,
} from '../src/config/model-policy.js';

const clearModelEnv = () => {
  for (const key of [
    'SHIPYARD_PLANNING_MODEL',
    'SHIPYARD_CODING_MODEL',
    'SHIPYARD_REVIEW_MODEL',
    'SHIPYARD_VERIFICATION_MODEL',
    'SHIPYARD_SUMMARY_MODEL',
    'SHIPYARD_INTENT_MODEL',
    'SHIPYARD_CHAT_MODEL',
  ] as const) {
    delete process.env[key];
  }
};

describe('getResolvedModelConfig', () => {
  beforeEach(() => {
    clearModelEnv();
  });
  afterEach(() => {
    clearModelEnv();
  });

  it('applies anthropic family defaults when env unset', () => {
    const c = getResolvedModelConfig('planning', { modelFamily: 'anthropic' });
    expect(c.model).toBe('claude-sonnet-4-5-20250929');
    const exec = getResolvedModelConfig('coding', { modelFamily: 'anthropic' });
    expect(exec.model).toBe('claude-haiku-4-5');
  });

  it('applies openai family defaults when env unset', () => {
    const p = getResolvedModelConfig('planning', { modelFamily: 'openai' });
    expect(p.model).toBe('gpt-5.4');
    const coding = getResolvedModelConfig('coding', { modelFamily: 'openai' });
    expect(coding.model).toBe('gpt-5.4-mini');
  });

  it('prefers per-stage override over family', () => {
    const c = getResolvedModelConfig('planning', {
      modelFamily: 'openai',
      modelOverrides: { planning: 'claude-opus-4-6' },
    });
    expect(c.model).toBe('claude-opus-4-6');
  });

  it('prefers env over family preset', () => {
    process.env['SHIPYARD_PLANNING_MODEL'] = 'claude-3-5-haiku-20241022';
    const c = getResolvedModelConfig('planning', { modelFamily: 'openai' });
    expect(c.model).toBe('claude-3-5-haiku-20241022');
  });

  it('clamps temperature to 1 for Opus overrides', () => {
    const c = getResolvedModelConfig('coding', {
      modelOverrides: { coding: 'claude-opus-4-6' },
    });
    expect(c.model).toBe('claude-opus-4-6');
    expect(c.temperature).toBe(1);
  });

  it('applies single run model override to chat', () => {
    const c = getResolvedModelConfig('chat', {
      legacyCodingOverride: 'gpt-5.4-mini',
    });
    expect(c.model).toBe('gpt-5.4-mini');
  });

  it('applies single run model override to planning when no stage override is provided', () => {
    const c = getResolvedModelConfig('planning', {
      legacyCodingOverride: 'gpt-5.3-codex',
    });
    expect(c.model).toBe('gpt-5.3-codex');
  });
});

describe('getModelConfig', () => {
  afterEach(() => {
    delete process.env['SHIPYARD_PLANNING_MODEL'];
    delete process.env['SHIPYARD_CODING_MODEL'];
  });

  it('uses defaults when env unset', () => {
    const c = getModelConfig('planning');
    expect(c.model).toBe('gpt-5.4');
    expect(c.temperature).toBe(0.3);
  });

  it('overrides model id from env', () => {
    process.env['SHIPYARD_PLANNING_MODEL'] = 'claude-3-5-haiku-20241022';
    const c = getModelConfig('planning');
    expect(c.model).toBe('claude-3-5-haiku-20241022');
    expect(c.maxTokens).toBe(16384);
  });
});

describe('isOpenAiModelId', () => {
  it('detects gpt-* ids', () => {
    expect(isOpenAiModelId('gpt-5.1-codex')).toBe(true);
    expect(isOpenAiModelId('  gpt-4o  ')).toBe(true);
  });

  it('rejects Claude ids', () => {
    expect(isOpenAiModelId('claude-sonnet-4-5-20250929')).toBe(false);
  });
});

describe('estimateCost', () => {
  it('includes gpt-5.4 rates', () => {
    const usd = estimateCost('gpt-5.4', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(2.5 + 10, 5);
  });

  it('includes gpt-5.4-nano rates', () => {
    const usd = estimateCost('gpt-5.4-nano', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(0.1 + 0.4, 5);
  });

  it('includes gpt-5.4-mini rates', () => {
    const usd = estimateCost('gpt-5.4-mini', 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(0.25 + 2, 5);
  });
});
