# Plan: One LangSmith Trace = Full Run X-Ray (v2)

## Definition: "Full Run X-Ray"

One shared trace link shows:
- Every LLM call (prompt + response)
- Every external tool call (redacted input/output)
- Every deterministic retry/escalation decision
- Every verification substep actually run
- Every final outcome summary

**Not** included (defer): routing edge functions (simple, inspectable already).

---

## 1. Privacy & Trace Sharing (MUST-HAVE, do first)

### Problem
`resolveLangSmithRunUrl()` in `src/runtime/langsmith.ts:100` auto-creates **public** share links. Tool payloads in `src/tools/index.ts:292` contain raw code, terminal output, file contents. Public traces leak source code.

### Fix
- **Default to internal (workspace) traces.** `buildTraceUrl()` already generates internal URLs.
- **Public sharing = explicit opt-in.** Add env var `SHIPYARD_TRACE_PUBLIC=true` (default `false`).
- Modify `resolveLangSmithRunUrl()`: only call `shareRun()` when `SHIPYARD_TRACE_PUBLIC=true`.
- Otherwise return `buildTraceUrl()` result (internal workspace URL).
- Callers in `src/runtime/loop.ts:983` unchanged — they just get internal URLs by default.

**Files**: `src/runtime/langsmith.ts`

---

## 2. Shared Tracing Helpers (MUST-HAVE, foundation for everything else)

New file: `src/runtime/trace-helpers.ts` (~80 LOC)

Four helpers, one per concern. Consistent naming, tags, metadata, redaction.

### `traceIfEnabled(fn, config)`
Wraps `fn` with `traceable()` only when `canTrace()` is true. Zero overhead otherwise.

### `traceToolCall(name, input, fn)`
- `run_type: 'tool'`
- `name: 'tool:{name}'`
- `tags: ['tool', name]`
- Span metadata at creation time includes stable fields only: `{ tool_name: name }`
- Helper measures runtime around `fn()`
- `processInputs`: delegates to tool-specific redactor (see §3)
- `processOutputs`: returns redacted tool output plus structured execution summary:
  `{ success, exit_code, duration_ms, error_kind, truncated, result }`
- Optional best-effort enhancement: if easy, patch the current run tree metadata with the same runtime fields after `fn()` resolves. Do not make correctness depend on that patch.

### `traceDecision(name, inputSummary, fn)`
- `run_type: 'chain'`
- `name: 'decision:{name}'`
- `tags: ['decision', name]`
- `processInputs`: returns `inputSummary` (caller picks relevant state fields)
- `processOutputs`: returns `{ decision, reason, ... }` from fn result

### `traceParser(name, rawText, fn)`
- `run_type: 'parser'`
- `name: 'parse:{name}'`
- `tags: ['parser', name]`
- Explicit `rawText` arg supplied by caller
- `processInputs`: `{ rawText: rawText.slice(0, 2000) }`
- `processOutputs`: structured parse result

**Files**: `src/runtime/trace-helpers.ts` (new)

---

## 3. Tool-Specific Redactors (MUST-HAVE)

Add to `src/runtime/trace-helpers.ts` (or a sibling `trace-redactors.ts` if it gets big).

### Redaction modes

Two modes, one policy surface:

- `internal` mode (`SHIPYARD_TRACE_PUBLIC=false`, default): may include short previews for debugging
- `public` mode (`SHIPYARD_TRACE_PUBLIC=true`): no raw code, no raw file content, no raw terminal text, no raw free-form command bodies

Public mode is the hard security bar. Internal mode can be slightly richer, but should still avoid obvious secret leakage where practical.

### Per-tool input redaction

| Tool | What to log | What to redact |
|---|---|---|
| `read_file` | path, offset, limit | — (no large input) |
| `write_file` | path, line count, content hash (first 8 chars of sha256) | full content |
| `edit_file` | path, old_string length, new_string length | full old_string/new_string |
| `bash` | internal: command preview (first 120 chars), timeout, cwd; public: command hash, timeout, cwd | raw command body |
| `grep` | pattern, path, glob, max_results | — |
| `glob` | pattern, cwd | — |
| `ls` | path | — |
| `spawn_agent` | task (first 200 chars), role | full task if > 200 chars |
| `ask_user` | question (first 200 chars) | — |
| `revert_changes` | scope, strategy, dry_run | — |
| `commit_and_open_pr` | title, branch_name, base_branch, draft | full body |
| `inject_context` | label, content length | full content |

### Per-tool output redaction

| Tool | What to log | What to redact |
|---|---|---|
| `read_file` | internal: success, line count, char count, first 5 + last 5 lines preview; public: success, line count, char count, content hash | full file content |
| `write_file` | success, bytes written | — |
| `edit_file` | success, tier, message, diff preview length | full diff preview |
| `bash` | internal: success, exit_code, duration_ms, stdout/stderr length, first 500 chars preview; public: success, exit_code, duration_ms, stdout/stderr length, stdout/stderr hash | full stdout/stderr |
| `grep` | success, match count; internal may include first 20 matches | full matches |
| `glob` | success, file count, first 10 paths | full list if > 10 |
| `ls` | success, entry count | — |
| `spawn_agent` | success, result summary | — |

Implementation: `redactToolInput(name, input, visibility)` and `redactToolOutput(name, result, visibility)` — each a switch on tool name returning a sanitized KVMap. `visibility` is `'internal' | 'public'`. All redacted outputs include `{ truncated: boolean }` flag.

**Files**: `src/runtime/trace-redactors.ts` (new, ~100 LOC)

---

## 4. Tool Call Tracing (MUST-HAVE, Phase 1)

**File**: `src/tools/index.ts`

Wrap the inner `dispatchToolRaw` call inside `dispatchTool()` with `traceToolCall()`:

```ts
import { traceToolCall } from '../runtime/trace-helpers.js';

export async function dispatchTool(name, input, hooks?, overlay?) {
  // snapshot + before hooks unchanged

  const startTime = Date.now();
  const result = await traceToolCall(name, input, () => dispatchToolRaw(name, input));
  const duration = Date.now() - startTime;

  // after hooks unchanged — they still get the raw result
  return result;
}
```

`traceToolCall` handles: span creation, redaction via `redactToolInput`/`redactToolOutput`, stable metadata (`tool_name`), and structured execution summary in span outputs (`success`, `exit_code`, `duration_ms`, `error_kind`, `truncated`).

Hooks/overlay logic stays exactly the same — tracing wraps only the raw dispatch, not the hook orchestration.

**Result in LangSmith**: Under each plan/execute node, child spans `tool:bash`, `tool:edit_file`, `tool:read_file`, etc. with redacted I/O + structured metadata.

---

## 5. Verify Tracing (MUST-HAVE, Phase 1)

**File**: `src/graph/nodes/verify.ts`

Extract a helper to reduce repetition:

```ts
import { traceToolCall } from '../../runtime/trace-helpers.js';

async function runVerifyStep(
  name: string,
  command: string,
  timeout: number,
  signal?: AbortSignal,
) {
  return traceToolCall(`verify:${name}`, { command }, () =>
    runBash({ command, timeout, cwd: WORK_DIR, signal })
  );
}
```

Replace the 3 inline `runBash()` calls with:
- `runVerifyStep('lint', 'pnpm run lint --if-present 2>&1', 120_000, signal)`
- `runVerifyStep('typecheck', 'pnpm type-check 2>&1', 120_000, signal)`
- `runVerifyStep('test', 'pnpm test 2>&1', 300_000, signal)`

Skipped steps (e.g., test skipped on non-final step) don't create spans — no noise.

**Result**: Verify node shows 2-3 child spans: `tool:verify:lint`, `tool:verify:typecheck`, `tool:verify:test`. Each has: command summary, exit_code, duration_ms, success, and redacted output per visibility mode.

---

## 6. Plan Extraction Tracing — Both Paths (MUST-HAVE, Phase 1)

### Anthropic path
**File**: `src/graph/nodes/plan.ts` (~L224-238)

Wrap `<plan>` regex + JSON.parse in `traceParser()`:

```ts
import { traceParser } from '../../runtime/trace-helpers.js';

const steps = await traceParser('plan_extraction', text, async () => {
  const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);
  // ... existing parse logic ...
  return { steps: parsed, stepCount: parsed.length };
});
```

### OpenAI path
**File**: `src/graph/nodes/plan-openai.ts` (~L156-171)

Same wrapper around the `<plan>` extraction at line 156:

```ts
import { traceParser } from '../../runtime/trace-helpers.js';

if (planMatch) {
  const parsed = await traceParser('plan_extraction', textContent, async () => {
    const result = JSON.parse(planMatch[1]!) as Array<{...}>;
    return { steps: result, stepCount: result.length };
  });
  steps = parsed.steps.map(s => ({ ...s, status: 'pending' as const }));
}
```

**Result**: Both provider paths show identical `parse:plan_extraction` spans with step count + step descriptions.

---

## 7. Review Tracing — 3 Spans (MUST-HAVE, Phase 1)

**File**: `src/graph/nodes/review.ts`

Split review into 3 traced sections:

### `decision:deterministic_guards` (lines 170-228)
Wrap the deterministic guard block that runs BEFORE the LLM call:

```ts
import { traceDecision } from '../../runtime/trace-helpers.js';

const deterministicResult = await traceDecision('deterministic_guards', {
  verPassed,
  failedSteps,
  scopeGuardOk: scopeGuard.ok,
  hasMoreSteps,
  editCount: state.fileEdits.length,
  retryCount: state.retryCount,
  explicitSingleTarget,
}, async () => {
  // existing deterministic guard logic
  // returns early result or null if LLM needed
});

if (deterministicResult) return deterministicResult;
```

Input shows the state that fed the guards. Output shows: `{ triggered: true/false, decision, reason }` or `{ triggered: false, reason: 'fell through to LLM' }`.

### `review:llm` (already traced)
The existing `messagesCreate()` / `completeTextForRole()` calls already produce LLM spans with `traceName: 'review'`. No change needed.

### `parse:review_decision` (lines 326-344)
Wrap JSON extraction:

```ts
import { traceParser } from '../../runtime/trace-helpers.js';

const { decision, feedback } = await traceParser('review_decision', text, async () => {
  const jsonMatch = text.match(/\{[\s\S]*"decision"[\s\S]*\}/);
  // ... existing parse ...
  return { decision, feedback, rawSnippet: text.slice(0, 500) };
});
```

**Result**: Review node shows: `decision:deterministic_guards` → (if fell through) `review [LLM]` → `parse:review_decision`. On deterministic short-circuit, you see guards triggered with the exact reason and no LLM call.

---

## 8. Error Recovery Tracing (Phase 2)

**File**: `src/graph/nodes/error-recovery.ts`

Wrap entire node body with `traceDecision()`:

```ts
import { traceDecision } from '../../runtime/trace-helpers.js';

export async function errorRecoveryNode(state) {
  return traceDecision('error_recovery', {
    reviewDecision: state.reviewDecision,
    retryCount: state.retryCount,
    maxRetries: state.maxRetries,
    error: state.error?.slice(0, 500),
    hasOverlaySnapshots: Boolean(state.fileOverlaySnapshots),
  }, async () => {
    // ... existing logic unchanged ...
    // return includes { decision: 'retry'|'abort', nextPhase, retryCount }
  });
}
```

**Result**: Span shows input (what failed, retry count, error snippet) → output (retry/abort + new phase).

---

## 9. Report Tracing (Phase 2)

**File**: `src/graph/nodes/report.ts`

Wrap with `traceDecision()` (it's a deterministic summary, not parsing):

```ts
import { traceDecision } from '../../runtime/trace-helpers.js';

export async function reportNode(state) {
  return traceDecision('report_summary', {
    phase: state.phase,
    stepsCompleted: state.steps.filter(s => s.status === 'done').length,
    totalSteps: state.steps.length,
    filesEdited: [...new Set(state.fileEdits.map(e => e.file_path))].length,
    hasPR: hasSuccessfulPrToolCall(state.toolCallHistory),
    error: state.error?.slice(0, 300),
  }, async () => {
    // ... existing logic ...
  });
}
```

---

## 10. Routing Spans (Phase 3 — DEFER)

`afterGate`, `afterPlan`, `afterReview`, `afterErrorRecovery` in `src/graph/edges.ts` are one-liners that map state → string. Already inspectable in the graph view. Add tracing later only if debugging reveals it's needed.

---

## Phased Rollout

### Phase 1 — Core observability (MUST-HAVE)
1. Privacy: internal traces by default (`src/runtime/langsmith.ts`)
2. Shared helpers: `traceIfEnabled`, `traceToolCall`, `traceDecision`, `traceParser` (`src/runtime/trace-helpers.ts`)
3. Tool-specific redactors (`src/runtime/trace-redactors.ts`)
4. Tool call tracing in `dispatchTool` (`src/tools/index.ts`)
5. Verify tracing with `runVerifyStep` helper (`src/graph/nodes/verify.ts`)
6. Plan extraction tracing — both Anthropic + OpenAI paths (`src/graph/nodes/plan.ts`, `src/graph/nodes/plan-openai.ts`)
7. Review tracing — deterministic guards + parse decision (`src/graph/nodes/review.ts`)

### Phase 2 — Full coverage
8. Error recovery decision tracing (`src/graph/nodes/error-recovery.ts`)
9. Report summary tracing (`src/graph/nodes/report.ts`)

### Phase 3 — If needed
10. Routing edge spans (`src/graph/edges.ts`)

---

## Files Modified

| File | Change | LOC | Phase |
|---|---|---|---|
| `src/runtime/langsmith.ts` | Internal traces by default, public opt-in via `SHIPYARD_TRACE_PUBLIC` | ~15 | 1 |
| `src/runtime/trace-helpers.ts` | **NEW** — `traceIfEnabled`, `traceToolCall`, `traceDecision`, `traceParser` | ~80 | 1 |
| `src/runtime/trace-redactors.ts` | **NEW** — per-tool `redactToolInput`, `redactToolOutput` | ~100 | 1 |
| `src/tools/index.ts` | Wrap `dispatchToolRaw` call with `traceToolCall` | ~8 | 1 |
| `src/graph/nodes/verify.ts` | `runVerifyStep` helper + wrap 3 bash calls | ~20 | 1 |
| `src/graph/nodes/plan.ts` | Wrap `<plan>` extraction with `traceParser` | ~10 | 1 |
| `src/graph/nodes/plan-openai.ts` | Wrap `<plan>` extraction with `traceParser` | ~10 | 1 |
| `src/graph/nodes/review.ts` | `traceDecision` on guards + `traceParser` on decision | ~25 | 1 |
| `src/graph/nodes/error-recovery.ts` | Wrap with `traceDecision` | ~15 | 2 |
| `src/graph/nodes/report.ts` | Wrap with `traceDecision` | ~10 | 2 |
| **Total** | 8 modified + 2 new | **~293 LOC** | |

---

## Tests

### Behavior tests (MUST-HAVE)
- `dispatchTool` still fires hooks AND overlay snapshots with tracing on AND off
- `reviewNode` behavior unchanged with tracing disabled (deterministic guards produce same results)
- `planNode` and `runOpenAiPlanLoop` extract identical steps with tracing on/off
- Failed traced tool calls propagate exact same result shape to callers
- `verifyNode` skips test span on non-final step (no ghost spans)

### Redactor unit tests
- `redactToolInput('write_file', { file_path: 'x', content: '...' })` returns `{ file_path, lineCount, contentHash }`, no raw content
- `redactToolInput('bash', { command: 'ls -la' }, 'public')` returns `{ commandHash, timeout, cwd }`, no raw command
- `redactToolOutput('read_file', { content: '..500 lines..' }, 'public')` returns line count + char count + content hash, no preview
- `redactToolOutput('bash', { stdout: '..10KB..' }, 'public')` returns lengths + hashes + truncated flag, no raw stdout

### Integration smoke test
- Mock `traceable` (or inject a recording spy via `traceIfEnabled`)
- Run a minimal graph invocation
- Assert spans requested with correct names: `tool:bash`, `tool:edit_file`, `tool:verify:typecheck`, `parse:plan_extraction`, `decision:deterministic_guards`, `parse:review_decision`
- Assert no raw file content, raw stdout/stderr, or raw bash command body in any public-mode span input/output
- Assert span outputs include `success`, `duration_ms`, `truncated` flags

---

## Success Criteria

1. One child span per tool call in execute/plan nodes
2. One child span per verify substep actually run (2-3 per run)
3. One `parse:plan_extraction` span on both Anthropic and OpenAI paths
4. One `decision:deterministic_guards` span when review short-circuits without LLM
5. One `parse:review_decision` span when LLM review runs
6. No raw file contents, raw terminal output, or raw bash command bodies in any span when `SHIPYARD_TRACE_PUBLIC=true`
7. Default traces are internal (workspace URLs), not public
8. `pnpm test` — all existing tests pass
9. `pnpm type-check` — clean
10. Run a test instruction → open trace link → verify all spans visible with redacted payloads
