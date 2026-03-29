# Ship-Agent Refactor Gap Closure Plan

**Date**: 2026-03-29
**Success metric**: Final isolated target passes `typecheck + build + test` with 0 new errors AND no recoverable `executionIssue` / retry residue in final run state.

## Phase 0: Audit (completed)

Evidence table — 4 parallel audit agents reviewed current state of all gaps:

| ID | Item | State | File:Line | Gap |
|----|------|-------|-----------|-----|
| G3 | `afterErrorRecovery` missing `executing` route | **REAL BUG** | `edges.ts:50` | Only routes `planning→plan`, else→`report`. error-recovery.ts:158 emits `executing` — dead code |
| G1 | No LLM call retry | **REAL** | `messages-create.ts:42`, `openai-helpers.ts:72` | Zero retry. Single 429/503 kills run |
| G4 | Rollback failure swallowed | **REAL** | `review.ts:218`, `error-recovery.ts:134` | Empty catch, dirty filesystem on retry |
| G5 | Baseline capture null silent | **REAL** | `run-baselines.ts:142,160` | Both paths resolve null, no log |
| F1 | Ambiguous multi-match edit | **OPEN** | `docs/issues.md:26`, `execute-progress.ts:408` | Rich nudge exists but not wired to first nudge |
| ~~G2~~ | maxToolRounds exhaustion | **STALE** | `execute.ts:927` | Already sets `executionIssue` |
| ~~T4~~ | Coordinator happy path tests | **STALE** | `coordinate-worker-plan.test.ts:86` | 3 paths tested |

## Phase 1: Silent Killers (completed)

### P0 — G3 edge fix
- `src/graph/edges.ts`: added `executing → execute` route in `afterErrorRecovery`
- `src/graph/builder.ts`: added `execute` target in `addConditionalEdges`
- `test/graph/edges.test.ts`: 4 new tests (planning→plan, executing→execute, error→report, other→report)

### P1 — G1 LLM retries
- Created `src/llm/retry.ts`: `withTransientRetry(fn, opts)` — 3 attempts, exponential backoff, abort-aware
- Uses existing `isTransientError` + `backoffMs` from error-recovery.ts + `sleep` from abort-sleep.ts
- Wrapped `messagesCreate` (Anthropic) and `chatCompletionCreateWithRetry` (OpenAI)
- `test/llm/retry.test.ts`: 8 tests (success, 503 retry, 429 retry, exhaustion, non-transient, abort, ECONNRESET, timeout)
- Updated `test/llm/retries.test.ts`: aligned with new retry behavior (3 attempts, not 1)

## Phase 2: Run-Breakers (completed)

### P2 — F1 ambiguous-edit recovery
- Added `lastFailingEditFilePath`, `lastFailingEditOldString`, `lastFailingEditFileContent` to `DecideNoEditProgressActionParams`
- `decideNoEditProgressAction` now tries `buildAmbiguousEditRecoveryNudge` (rich, line-number-aware) on first nudge when blocker is `ambiguous_edit` and file content is available
- Wired from both `execute.ts` (Anthropic, 2 call sites) and `execute-openai.ts` (OpenAI, 2 call sites)
- Removed redundant post-nudge enhancement code in execute.ts (was only firing on 2nd nudge)

### P3a — G4 rollback observability
- `review.ts`: `rollbackOverlays` now returns `{success, error?}`. Failure appended to `reviewFeedback` as warning
- `error-recovery.ts`: empty catch replaced with `console.warn` including runId

### P3b — G5 baseline observability
- `run-baselines.ts`: both failure paths now log with `console.warn` including runId and failure reason
- Git ops failure: warns about skipped per-edit typecheck + baseline diffing
- Fingerprint capture failure: warns about raw error count fallback

## Phase 3: Coverage (P4 — completed)

`test/graph/integration.test.ts` — 7 tests covering full graph pipeline:
1. Happy path: gate → plan → **coordinate** → verify → review → report
2. `forceSequential` routes plan → **execute** (not coordinate)
3. Review retry loop: plan → coordinate → verify → review(retry) → plan → done
4. Escalate → error_recovery → **plan** (retry path)
5. **G3 fix verified**: error_recovery → **execute** when `phase=executing`
6. Q&A gate → immediate end (no plan/execute/report)
7. Review continue → execute next step (step advancement, no re-plan)

Also: `afterErrorRecovery` edge tests (3 phases) in `test/graph/edges.test.ts` (done in P0)

Total: 227 tests across 18 graph+llm test files, all passing.

## Phase 4: Planless Rebuild Infrastructure (P5 — completed code, pending execution)

### Completed (code)
- Task 6: PRD context tests — `planDoc` acceptance + 500KB rejection tests added to `routes.test.ts`
- Task 8: Planless integration test — `integration.test.ts` case: gate→coordinate (skips plan) verified
- Task 9: Rebuild runner contract — `run-rebuild.sh` now supports `REBUILD_PLAN_FILE` and `REBUILD_PLAN_DOC_FILE` env vars for planless mode

### Pending (execution)
- Task 10: Full isolated rebuild campaign
  - Isolated target repo
  - 7-instruction rebuild via `scripts/run-rebuild.sh` with planless mode
  - Archive traces + issues
  - Gate: `scripts/run-rebuild.sh:396` final gate must pass
  - Done-when: final gate green + no recoverable `executionIssue` / retry residue in final run state

## Reference Docs

- PRD: `docs/plans/2026-03-29-planless-rebuild-prd.md`
- Wireframes: `docs/plans/2026-03-29-planless-rebuild-wireframes.md`
- Implementation plan: `docs/plans/2026-03-29-planless-agent-implementation.md`

## Benchmark Truth Sources

- Raw runs: `results/*.json`
- Snapshots: `results/snapshot-*.json`
- Event audit: `results/events/*.json`
- Rebuild summary: `docs/rebuild-run-2026-03-28.md`
- Rebuild audit bundle: `docs/rebuild-run-audit.html`
- Report generator: `src/reporting/benchmarks-report.ts`
- Renderer: `scripts/render-benchmarks.ts`

`docs/benchmarks.md` should evolve toward “best verified runs first, latest attempts second” so rebuild reference data is useful for planning instead of dominated by noisy retries.

## Test Results

1035+ tests pass (1024 existing + 2 aligned retry + 8 integration + 2 planDoc context). Zero regressions.
Pre-existing failures: 3 in `github-thread-continuity.test.ts` (race condition, not related).
