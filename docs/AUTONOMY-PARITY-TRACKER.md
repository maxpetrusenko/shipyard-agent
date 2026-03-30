# Autonomy Parity Tracker

Last updated: 2026-03-26
Owner: Shipyard core loop
Goal: close parity gaps vs Open SWE / Codex / Cursor patterns and keep score visible per feature.

## Scoring Model
- 1-3: missing or fragile
- 4-6: partial
- 7-8: solid
- 9: production-ready
- 10: production-ready plus observability, tests, and docs

## High Signal (Top 10)

| # | Feature | Status | Score | Evidence | Next |
|---|---|---|---|---|---|
| H1 | Persistent instruction loop + resumable runs | Done | 9 | `src/runtime/loop.ts`, run list/status endpoints | Add chaos test for restart during active run |
| H2 | Plan -> execute -> verify -> review loop | Done | 9 | `src/graph/builder.ts`, node tests | Add stricter regression pack on long retry chains |
| H3 | Surgical edit strategy (multi-tier) | Done | 9 | `src/tools/edit-file.ts`, edit tests | Add per-tier runtime counters to dashboard |
| H4 | Provider readiness + no-fallback policy | Done | 9 | `src/server/provider-readiness.ts`, `provider-policy.ts` | Add route-level policy audit endpoint |
| H5 | Scope guardrails / anti-drift | Done | 8 | `src/graph/guards.ts`, `gate.test.ts` | Add assertion coverage for multi-step partial completion |
| H6 | Invoke + webhook reliability (dedupe, DLQ, audit) | Done | 8 | `invoke-routes.ts`, `dedupe-store.ts`, `dead-letter.ts`, tests | Add replay simulation test matrix |
| H7 | Retry controls + idempotency | Done | 9 | `invoke-routes.ts`, `routes.test.ts` | Add idempotency TTL stats in ops metrics |
| H8 | Prompt cache wiring (system/tools/tool_result) | Done | 9 | `src/config/client.ts`, `anthropic-tool-dispatch.ts`, `prompt-cache.test.ts` | Add per-run cache ratio on UI |
| H9 | Context compaction in Anthropic + OpenAI loops | Done (new) | 9 | `src/llm/message-compaction.ts`, `src/llm/openai-message-compaction.ts`, wired in plan/execute/chat for both providers, compaction tests | Add ops counters and dashboard visibility |
| H10 | Done gate automation | Done | 10 | `scripts/done-gate.sh`, `scripts/flake-check.sh`, `done:check` | Keep flake target list updated |

## Medium Signal (Top 10)

| # | Feature | Status | Score | Evidence | Next |
|---|---|---|---|---|---|
| M1 | Codex CLI readiness and login diagnostics | Done | 8 | `codex-cli-status.ts`, provider readiness tests | Add auto-remediation command hints per OS |
| M2 | Dashboard modularization | Done | 8 | split files under `src/server/dashboard-*.ts` | Add component-level smoke tests |
| M3 | Auth scopes (invoke/retry/admin/read) | Done | 9 | `auth-scopes.ts`, `auth-scopes.test.ts`, `docs/ROUTE-SCOPE-MATRIX.md` | Add route-to-scope drift check test |
| M4 | HMAC support for signed ingress | Done | 8 | `hmac-auth.ts`, route wiring | Add replay-window validation option |
| M5 | Event persistence retention policy | Done | 8 | `event-persistence.ts`, tests | Add retention metrics endpoint |
| M6 | Memory guard | Done | 8 | `memory-guard.ts`, tests | Add pressure test under load script |
| M7 | Run contract validation | Done | 8 | `run-contract.ts`, tests | Enforce contract checks in CI gate |
| M8 | Ops metrics endpoint | Done (updated) | 8 | `ops.ts`, `/api/metrics` now includes counters + timings, settings surfaces cache/compaction stats | Add alert thresholds |
| M9 | Follow-up thread continuity context | Done | 8 | `loop.ts` continuation snapshot | Add truncation policy tests |
| M10 | Commit-and-open-pr hardening | Done | 8 | `commit-and-open-pr.ts`, tests | Add branch protection preflight checks |

## Low Signal (Top 10)

| # | Feature | Status | Score | Evidence | Next |
|---|---|---|---|---|---|
| L1 | Human setup runbook | Done | 8 | `docs/HUMAN-STEPS-AUTONOMY.md` | Keep in sync with env changes |
| L2 | Landing hero and marketing copy | Done | 7 | `src/server/hero.ts` | Refresh to match current capability set |
| L3 | Benchmark radar + snapshots UI | Done | 8 | `src/server/benchmarks.ts`, `benchmark-api.ts` | Add baseline pinning in UI |
| L4 | Retry modal UX polish | Done | 8 | `dashboard-retry.ts`, tests | Add keyboard accessibility pass |
| L5 | Settings diagnostics panel | Done | 8 | `dashboard-settings.ts` | Show token scope status inline |
| L6 | Timeline readability heuristics | Done | 7 | `dashboard-timeline.ts` | Add truncation expand/collapse tests |
| L7 | Sidebar/chat affordances | Done | 7 | `dashboard-sidebar.ts` | Add mobile-specific QA snapshot tests |
| L8 | Docs list + plans archive | Partial | 6 | docs/plans + docs files | Add consistent front matter + read_when tags |
| L9 | Screenshot-based visual checks | Partial | 6 | `dashboard-visual-check.png` artifact flow | Automate compare script in CI |
| L10 | Social/release workflow docs | Partial | 5 | sparse docs | Add release checklist and post template |

## Current Execution Queue
Completed in current batch:
1. Route-level scope/permission matrix doc and tests
2. Long-run reliability soak using `scripts/load-test.ts` (plus auth/payload/source fixes)
3. Flake detector integrated into `done:check`
4. Run-level reliability report from invoke queue replay tests
5. Unskip + stabilize `loop-shortcuts` skipped tests with deterministic harness

Next queue (new):
1. Add `load:test` acceptance thresholds + non-zero retry assertions
2. Add nightly soak workflow artifact upload
3. Add route-to-scope drift detector test over route registry
4. Add idempotency TTL metrics in dashboard settings panel
5. Add alert threshold docs for key ops counters/timings

## Notes
- This tracker is the canonical source for done vs left.
- Update it in every implementation batch before handoff.
