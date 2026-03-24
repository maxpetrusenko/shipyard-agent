# Chat Rename Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users delete chats from dashboard history and rename titles with the current local prompt flow.

**Architecture:** Reuse the existing `InstructionLoop.deleteRun()` backend seam and expose it via a REST route. Keep title rename browser-local, then add delete buttons in the dashboard JS render path so both sidebar items and the selected thread can delete the current chat.

**Tech Stack:** TypeScript, Express, vanilla dashboard JS, Vitest

---

### Task 1: Add failing delete API tests

**Files:**
- Modify: `test/server/routes.test.ts`

**Step 1: Write the failing tests**

- Add one test for successful `DELETE /api/runs/:id`
- Add one test for `409` when deleting the active run

**Step 2: Run tests to verify they fail**

Run: `pnpm test test/server/routes.test.ts`

Expected: delete route tests fail because the endpoint does not exist yet.

### Task 2: Expose run deletion via REST

**Files:**
- Modify: `src/server/routes.ts`

**Step 1: Add `DELETE /runs/:id`**

- Call `loop.deleteRun(runId)`
- Return `200` on success
- Return `404` for missing runs
- Return `409` for active run guard

**Step 2: Run targeted tests**

Run: `pnpm test test/server/routes.test.ts`

Expected: route tests pass.

### Task 3: Add dashboard delete controls

**Files:**
- Modify: `src/server/dashboard.ts`
- Add or modify test: `test/server/dashboard.test.ts`

**Step 1: Write the failing dashboard test**

- Assert `/dashboard` HTML includes delete chat controls

**Step 2: Run test to verify it fails**

Run: `pnpm test test/server/dashboard.test.ts`

Expected: fail because delete controls are not rendered yet.

**Step 3: Implement minimal UI**

- Add delete buttons in sidebar rows and selected thread header
- Wire click handling to call `DELETE /api/runs/:id`
- Remove deleted runs from local state and clear selection when needed
- Reuse confirm dialog; disable or hide delete for active run

**Step 4: Run dashboard test**

Run: `pnpm test test/server/dashboard.test.ts`

Expected: pass.

### Task 4: Regression verification

**Files:**
- Modify: `src/server/dashboard.ts`
- Modify: `src/server/routes.ts`
- Modify: `test/server/routes.test.ts`
- Add or modify: `test/server/dashboard.test.ts`

**Step 1: Run focused suite**

Run: `pnpm test test/server/routes.test.ts test/server/dashboard.test.ts`

Expected: all targeted tests pass.

**Step 2: Run broader gate**

Run: `pnpm test`

Expected: full suite passes or surfaces unrelated failures explicitly.
