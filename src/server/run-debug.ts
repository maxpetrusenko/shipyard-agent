import {
  MODEL_CONFIGS,
  getResolvedModelConfig,
  type ModelRole,
} from '../config/model-policy.js';
import type { RunResult } from '../runtime/loop.js';

export interface RunDebugSnapshot {
  runId: string;
  phase: RunResult['phase'];
  threadKind: RunResult['threadKind'] | null;
  runMode: RunResult['runMode'] | null;
  executionPath: RunResult['executionPath'] | null;
  instruction: string;
  primaryRole: ModelRole | null;
  primaryModel: string | null;
  resolvedModels: Partial<Record<ModelRole, string>>;
  modelFamily: RunResult['modelFamily'] | null;
  modelOverride: RunResult['modelOverride'] | null;
  modelOverrides: RunResult['modelOverrides'] | null;
  queuedAt: string | null;
  startedAt: string | null;
  savedAt: string | null;
  queueWaitMs: number | null;
  durationMs: number;
  tokenUsage: RunResult['tokenUsage'];
  traceUrl: string | null;
  localTraceUrl: string;
  openTraceUrl: string;
  error: string | null;
  stepCount: number;
  toolCallCount: number;
  fileEditCount: number;
  messageCount: number;
}

const MODEL_ROLES = Object.keys(MODEL_CONFIGS) as ModelRole[];

function primaryRoleForRun(run: RunResult): ModelRole | null {
  if (run.executionPath === 'local-shortcut') return null;
  if (run.threadKind === 'ask') return 'chat';
  if (run.phase === 'planning' || run.phase === 'awaiting_confirmation') return 'planning';
  if (run.phase === 'reviewing') return 'review';
  if (run.phase === 'verifying') return 'verification';
  return 'coding';
}

function fallbackResolvedModels(run: RunResult): Partial<Record<ModelRole, string>> {
  const out: Partial<Record<ModelRole, string>> = {};
  for (const role of MODEL_ROLES) {
    out[role] = getResolvedModelConfig(role, {
      legacyCodingOverride: run.modelOverride ?? null,
      modelFamily: run.modelFamily ?? null,
      modelOverrides: run.modelOverrides ?? null,
    }).model;
  }
  return out;
}

function safeIso(value?: string): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function queueWaitMs(queuedAt: string | null, startedAt: string | null): number | null {
  if (!queuedAt || !startedAt) return null;
  const diff = Date.parse(startedAt) - Date.parse(queuedAt);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

export function buildRunDebugSnapshot(run: RunResult): RunDebugSnapshot {
  const resolvedModels = run.resolvedModels ?? fallbackResolvedModels(run);
  const primaryRole = primaryRoleForRun(run);
  const queuedAt = safeIso(run.queuedAt);
  const startedAt = safeIso(run.startedAt);
  const savedAt = safeIso(run.savedAt);
  const localTraceUrl = `/api/runs/${encodeURIComponent(run.runId)}/debug`;
  const instruction =
    run.messages.find((msg) => msg.role === 'user')?.content ?? '';

  return {
    runId: run.runId,
    phase: run.phase,
    threadKind: run.threadKind ?? null,
    runMode: run.runMode ?? null,
    executionPath: run.executionPath ?? null,
    instruction,
    primaryRole,
    primaryModel: primaryRole ? resolvedModels[primaryRole] ?? null : null,
    resolvedModels,
    modelFamily: run.modelFamily ?? null,
    modelOverride: run.modelOverride ?? null,
    modelOverrides: run.modelOverrides ?? null,
    queuedAt,
    startedAt,
    savedAt,
    queueWaitMs: queueWaitMs(queuedAt, startedAt),
    durationMs: run.durationMs,
    tokenUsage: run.tokenUsage ?? null,
    traceUrl: run.traceUrl ?? null,
    localTraceUrl,
    openTraceUrl: run.traceUrl ?? localTraceUrl,
    error: run.error ?? null,
    stepCount: run.steps.length,
    toolCallCount: run.toolCallHistory.length,
    fileEditCount: run.fileEdits.length,
    messageCount: run.messages.length,
  };
}
