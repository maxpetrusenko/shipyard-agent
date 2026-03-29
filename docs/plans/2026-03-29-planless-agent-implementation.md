# Planless Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove planner-from-runtime for rebuild execution by letting Shipyard accept a supplied plan and execute it directly, while improving benchmark reporting to preserve best verified runs.

**Architecture:** Add a planless execution path at the graph entry. If a run includes a supplied execution plan, the gate stores those steps in state and routes directly to `coordinate` or `execute` without calling `planNode`. Keep planning available as a separate thread kind, but not in rebuild mode. Update benchmark reporting so `docs/benchmarks.md` shows best verified evidence first and latest attempts separately.

**Tech Stack:** TypeScript, LangGraph, Express, Vitest, markdown docs.

---

### Task 1: Add state for supplied plans

**Files:**
- Modify: `src/graph/state.ts`
- Test: `test/graph/state.test.ts`

**Step 1: Write failing tests**

Add tests for new state fields such as `suppliedPlan`, `planSource`, or equivalent metadata.

**Step 2: Run tests**

Run: `pnpm test test/graph/state.test.ts`

**Step 3: Add minimal state fields**

Add fields needed to distinguish user-supplied plan execution from planner-generated runs.

**Step 4: Re-run tests**

Run: `pnpm test test/graph/state.test.ts`

---

### Task 2: Accept supplied plan in API payload

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/runtime/loop.ts`
- Test: `test/server/routes.test.ts`

**Step 1: Write failing API tests**

Cover payload acceptance for `executionPlan` or equivalent field.

**Step 2: Run tests**

Run: `pnpm test test/server/routes.test.ts`

**Step 3: Implement payload plumbing**

Thread the supplied plan into run creation and persistence.

**Step 4: Re-run tests**

Run: `pnpm test test/server/routes.test.ts`

---

### Task 3: Skip planner when supplied plan exists

**Files:**
- Modify: `src/graph/nodes/gate.ts`
- Modify: `src/graph/edges.ts`
- Modify: `src/graph/builder.ts`
- Test: `test/graph/edges.test.ts`
- Test: `test/graph/gate.test.ts`

**Step 1: Write failing gate/edge tests**

Cover route behavior when a valid supplied plan exists.

**Step 2: Run tests**

Run: `pnpm test test/graph/edges.test.ts test/graph/gate.test.ts`

**Step 3: Implement planner bypass**

Populate `steps` directly from supplied plan and route around `planNode`.

**Step 4: Re-run tests**

Run: `pnpm test test/graph/edges.test.ts test/graph/gate.test.ts`

---

### Task 4: Validate supplied plan shape before execution

**Files:**
- Modify: `src/graph/nodes/gate.ts`
- Test: `test/graph/gate.test.ts`

**Step 1: Write failing validation tests**

Cases: empty step list, duplicate indices, missing descriptions, malformed file lists.

**Step 2: Run tests**

Run: `pnpm test test/graph/gate.test.ts`

**Step 3: Implement validation**

Reject bad plans before execution and return actionable errors.

**Step 4: Re-run tests**

Run: `pnpm test test/graph/gate.test.ts`

---

### Task 5: Make coordinator the default planless executor

**Files:**
- Modify: `src/graph/edges.ts`
- Modify: `src/graph/nodes/coordinate-worker-plan.ts`
- Test: `test/graph/coordinate-worker-plan.test.ts`

**Step 1: Write failing tests**

Verify supplied-plan runs go through coordinator by default and preserve step ordering.

**Step 2: Run tests**

Run: `pnpm test test/graph/coordinate-worker-plan.test.ts test/graph/edges.test.ts`

**Step 3: Implement minimal behavior**

Use supplied steps directly; avoid planner assumptions in coordinator messages.

**Step 4: Re-run tests**

Run: `pnpm test test/graph/coordinate-worker-plan.test.ts test/graph/edges.test.ts`

---

### Task 6: Add rebuild setup contexts for PRD and wireframes

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/server/dashboard-composer.ts`
- Modify: `src/server/dashboard-detail.ts`
- Test: `test/server/dashboard.test.ts`

**Step 1: Write failing UI/API tests**

Cover attached PRD and wireframe context visibility in rebuild runs.

**Step 2: Run tests**

Run: `pnpm test test/server/dashboard.test.ts`

**Step 3: Implement context affordances**

Allow attaching rebuild reference docs as contexts without triggering the planner.

**Step 4: Re-run tests**

Run: `pnpm test test/server/dashboard.test.ts`

---

### Task 7: Improve benchmark ranking for best verified runs

**Files:**
- Modify: `src/reporting/benchmarks-report.ts`
- Modify: `docs/benchmarks.md`
- Test: `test/reporting/benchmarks-report.test.ts`

**Step 1: Write failing report tests**

Cases:
- best verified run outranks newer failed run
- latest attempts still render separately
- rebuild final gate section renders current truth

**Step 2: Run tests**

Run: `pnpm test test/reporting/benchmarks-report.test.ts`

**Step 3: Implement ranking**

Add separate sections:
- best verified runs
- latest attempts
- rebuild final gates

**Step 4: Re-render docs**

Run: `pnpm exec tsx scripts/render-benchmarks.ts`

**Step 5: Re-run tests**

Run: `pnpm test test/reporting/benchmarks-report.test.ts`

---

### Task 8: Add direct planner-bypass integration test

**Files:**
- Test: `test/graph/planless-integration.test.ts`
- Modify: `src/graph/builder.ts` if needed for testability

**Step 1: Write failing integration test**

Use real graph builder, mocked LLM/tool surfaces, supplied plan in initial state, assert route skips `planNode`.

**Step 2: Run test**

Run: `pnpm test test/graph/planless-integration.test.ts`

**Step 3: Implement minimal fixes**

Adjust graph or helpers only if needed to make planner bypass deterministic.

**Step 4: Re-run test**

Run: `pnpm test test/graph/planless-integration.test.ts`

---

### Task 9: Validate rebuild runner against planless mode

**Files:**
- Modify: `scripts/run-rebuild.sh`
- Modify: `docs/rebuild-run-2026-03-28.md` if behavior changes
- Test: `test/reporting/issue-truth.test.ts` or new rebuild-runner focused test if appropriate

**Step 1: Add runner contract**

Ensure rebuild runner can submit supplied plan + reference docs.

**Step 2: Run focused validation**

Run the narrowest rebuild-runner validation available in this repo.

**Step 3: Keep final gate as source of truth**

Do not change completion semantics; `run_final_integration_gate` remains the final arbiter.

---

### Task 10: Full gate and rebuild proof

**Files:**
- No new source files required

**Step 1: Run full code gate**

Run: `pnpm type-check && pnpm test`

**Step 2: Run isolated rebuild campaign**

Run: `scripts/run-rebuild.sh` with isolated target and archived state prefix.

**Step 3: Verify done criteria**

Confirm:
- final gate green
- no recoverable `executionIssue`
- best verified benchmark rows updated

---

Plan complete and saved to `docs/plans/2026-03-29-planless-agent-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
