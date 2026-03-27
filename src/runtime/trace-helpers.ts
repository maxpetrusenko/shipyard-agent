/**
 * Shared tracing helpers for LangSmith span instrumentation.
 *
 * All helpers are no-ops when tracing is disabled — zero overhead.
 */

import { traceable } from 'langsmith/traceable';
import { canTrace } from './langsmith.js';
import { redactToolInput, redactToolOutput } from './trace-redactors.js';

type KVMap = Record<string, unknown>;

// ---------------------------------------------------------------------------
// State output sanitizer — strips raw content from partial graph state
// ---------------------------------------------------------------------------

/** Fields that are inherently safe enum/scalar values (no raw text possible). */
const SAFE_SCALARS = new Set([
  'phase', 'decision', 'reviewDecision', 'retryCount',
  'currentStepIndex', 'modelHint',
]);

function sanitizeDecisionOutput(raw: unknown): KVMap {
  if (raw === null || raw === undefined) return { result: null };
  if (typeof raw !== 'object') return { result: String(raw).slice(0, 200) };
  const obj = raw as KVMap;
  const safe: KVMap = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (SAFE_SCALARS.has(key)) {
      safe[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    } else if (key === 'error' || key === 'reviewFeedback') {
      // May contain code snippets or LLM text — truncate aggressively
      safe[key] = typeof value === 'string' ? value.slice(0, 150) : value;
    } else if (key === 'fileOverlaySnapshots') {
      // Contains serialized file contents — log presence only
      safe[key] = typeof value === 'string' ? `[snapshot: ${value.length} chars]` : Boolean(value);
    } else if (key === 'messages') {
      // Strip full messages, just log count
      safe['messageCount'] = Array.isArray(value) ? value.length : 0;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    }
    // Skip arrays, objects, and anything else (fileEdits, etc.)
  }
  return safe;
}

// ---------------------------------------------------------------------------
// traceIfEnabled — generic wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap `fn` with `traceable()` only when LangSmith tracing is active.
 * Returns `fn` unchanged when tracing is off.
 */
export function traceIfEnabled<T extends (...args: never[]) => unknown>(
  fn: T,
  config: {
    name: string;
    run_type?: string;
    tags?: string[];
    metadata?: KVMap;
    processInputs?: (inputs: KVMap) => KVMap;
    processOutputs?: (outputs: KVMap) => KVMap;
  },
): T {
  if (!canTrace()) return fn;
  return traceable(fn, {
    name: config.name,
    run_type: config.run_type ?? 'chain',
    tags: config.tags,
    metadata: config.metadata,
    processInputs: config.processInputs,
    processOutputs: config.processOutputs,
  }) as unknown as T;
}

// ---------------------------------------------------------------------------
// traceToolCall — tool span with redaction
// ---------------------------------------------------------------------------

export async function traceToolCall<R>(
  name: string,
  input: KVMap,
  fn: () => Promise<R>,
): Promise<R> {
  if (!canTrace()) return fn();

  const startTime = Date.now();
  const traced = traceable(
    async (_input: KVMap) => {
      const result = await fn();
      return result as unknown as KVMap;
    },
    {
      name: `tool:${name}`,
      run_type: 'tool',
      tags: ['tool', name],
      processInputs: (inputs: KVMap) => redactToolInput(name, (inputs['_input'] ?? inputs) as KVMap),
      processOutputs: (outputs: KVMap) => {
        const raw = (outputs['outputs'] ?? outputs) as KVMap;
        const redacted = redactToolOutput(name, raw);
        return {
          ...redacted,
          duration_ms: Date.now() - startTime,
        };
      },
      metadata: { tool_name: name },
    },
  );

  return traced(input) as unknown as Promise<R>;
}

// ---------------------------------------------------------------------------
// traceDecision — deterministic decision span
// ---------------------------------------------------------------------------

export async function traceDecision<R>(
  name: string,
  inputSummary: KVMap,
  fn: () => Promise<R>,
): Promise<R> {
  if (!canTrace()) return fn();

  const traced = traceable(
    async (_summary: KVMap) => fn(),
    {
      name: `decision:${name}`,
      run_type: 'chain',
      tags: ['decision', name],
      processInputs: (inputs: KVMap) => (inputs['_summary'] ?? inputs) as KVMap,
      processOutputs: (outputs: KVMap) => {
        const raw = outputs['outputs'] ?? outputs;
        return sanitizeDecisionOutput(raw);
      },
    },
  );

  return traced(inputSummary) as Promise<R>;
}

// ---------------------------------------------------------------------------
// traceParser — parsing span
// ---------------------------------------------------------------------------

/** Strip raw text fields from parser output before it reaches the trace. */
function sanitizeParserOutput(raw: unknown): KVMap {
  if (raw === null || raw === undefined) return { result: null };
  if (typeof raw !== 'object') return { result: String(raw).slice(0, 200) };
  const obj = raw as KVMap;
  const safe: KVMap = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    // Strip any field that could contain raw LLM text
    if (key === 'rawSnippet' || key === 'rawText') continue;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[key] = value;
    } else if (typeof value === 'string') {
      safe[key] = value.slice(0, 200);
    } else if (Array.isArray(value)) {
      safe[key] = `[array of ${value.length}]`;
    }
    // Skip nested objects
  }
  return safe;
}

export async function traceParser<R>(
  name: string,
  fn: () => Promise<R>,
  rawText?: string,
): Promise<R> {
  if (!canTrace()) return fn();

  const traced = traceable(
    async (_ctx: KVMap) => fn(),
    {
      name: `parse:${name}`,
      run_type: 'parser',
      tags: ['parser', name],
      processInputs: () => ({
        textLength: rawText?.length ?? 0,
        hasInput: Boolean(rawText),
      }),
      processOutputs: (outputs: KVMap) => {
        const raw = outputs['outputs'] ?? outputs;
        return sanitizeParserOutput(raw);
      },
    },
  );

  return traced({}) as Promise<R>;
}
