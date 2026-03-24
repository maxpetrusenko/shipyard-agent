# Run Debug Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** add a reply-level debug modal that always opens, always has a local trace fallback, and exposes the model and timing metadata needed to debug slow routing.

**Architecture:** persist minimal run metadata in `InstructionLoop`, build a normalized debug snapshot in `src/server/run-debug.ts`, expose it through a small API route, and render it in a dedicated dashboard modal module. Keep dashboard timeline rendering dumb and let the modal fetch fresh debug data on demand.

**Tech Stack:** TypeScript, Express, vanilla browser JS, Vitest

---

### Task 1: Persist minimal run debug metadata

**Files:**
- Modify: `src/runtime/loop.ts`
- Modify: `src/runtime/persistence.ts`
- Test: `test/runtime/loop.test.ts`

**Step 1: Write the failing test**

- Add assertions that completed runs include `queuedAt`, `startedAt`, `executionPath`, and resolved model metadata.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/runtime/loop.test.ts`
Expected: FAIL on missing debug metadata

**Step 3: Write minimal implementation**

- Extend `RunResult`
- Record metadata in local shortcut and graph paths
- Parse and serialize the new fields

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/runtime/loop.test.ts`
Expected: PASS

### Task 2: Add server-side debug snapshot builder

**Files:**
- Create: `src/server/run-debug.ts`
- Modify: `src/server/routes.ts`
- Test: `test/server/routes.test.ts`

**Step 1: Write the failing test**

- Add `GET /api/runs/:id/debug` coverage for a trivial ask run.

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/server/routes.test.ts`
Expected: FAIL with missing route

**Step 3: Write minimal implementation**

- Build a normalized snapshot
- Add local trace fallback
- Return 404 for missing runs

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/server/routes.test.ts`
Expected: PASS

### Task 3: Replace dead trace action with debug modal

**Files:**
- Create: `src/server/dashboard-debug.ts`
- Modify: `src/server/dashboard.ts`
- Modify: `src/server/dashboard-timeline.ts`
- Modify: `src/server/html-shared.ts`
- Test: `test/server/dashboard-timeline.test.ts`
- Test: `test/server/dashboard.test.ts`

**Step 1: Write the failing test**

- Assert assistant replies use the debug action
- Assert dashboard HTML includes modal container

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/server/dashboard-timeline.test.ts test/server/dashboard.test.ts`
Expected: FAIL on missing modal / old action

**Step 3: Write minimal implementation**

- Add modal HTML and styles
- Add modal fetch/render script
- Wire `i` button to modal open

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/server/dashboard-timeline.test.ts test/server/dashboard.test.ts`
Expected: PASS

### Task 4: Full verification

**Files:**
- Modify: any touched files from previous tasks only if needed

**Step 1: Run focused tests**

Run: `pnpm vitest run test/runtime/loop.test.ts test/server/routes.test.ts test/server/dashboard-timeline.test.ts test/server/dashboard.test.ts`
Expected: PASS

**Step 2: Run full gate**

Run: `pnpm type-check`
Run: `pnpm build`
Run: `pnpm test`
Expected: PASS
