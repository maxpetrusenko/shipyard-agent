# Chat Model Trace Decoupling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** make every chat interaction carry the currently selected model settings so debug metadata and traces stop drifting back to Claude defaults.

**Architecture:** keep the existing graph pipeline, but thread model settings through every interaction boundary. Chat follow-ups must accept fresh model preferences, and local shortcut runs must persist resolved model metadata instead of relying on debug-time fallback reconstruction.

**Tech Stack:** TypeScript, Express, Vitest, dashboard browser client

---

### Task 1: Lock the bug with loop tests

**Files:**
- Modify: `test/runtime/loop.test.ts`

**Step 1: Write the failing test**

Add tests that prove:
- a shortcut chat run submitted with `modelFamily: 'openai'` stores OpenAI resolved models
- an Ask follow-up can switch to fresh OpenAI settings and persists them on the run

**Step 2: Run test to verify it fails**

Run: `pnpm test test/runtime/loop.test.ts`

Expected: FAIL because local shortcut runs currently persist `resolvedModels: null` and Ask follow-ups cannot accept fresh model settings.

### Task 2: Thread model settings through follow-ups

**Files:**
- Modify: `src/runtime/loop.ts`
- Modify: `src/server/routes.ts`
- Modify: `src/server/dashboard.ts`

**Step 1: Write the failing test**

Extend the loop test from Task 1 to cover follow-up model-family replacement.

**Step 2: Run test to verify it fails**

Run: `pnpm test test/runtime/loop.test.ts`

Expected: FAIL because `followUpAsk()` only reuses stale settings from the existing thread.

**Step 3: Write minimal implementation**

- let `followUpAsk()` accept optional model settings
- let `/api/runs/:id/followup` parse `model`, `modelFamily`, and `models`
- send current settings from dashboard follow-up requests

**Step 4: Run test to verify it passes**

Run: `pnpm test test/runtime/loop.test.ts`

Expected: PASS

### Task 3: Persist shortcut model metadata

**Files:**
- Modify: `src/runtime/loop.ts`

**Step 1: Write the failing test**

Reuse the shortcut test from Task 1.

**Step 2: Run test to verify it fails**

Run: `pnpm test test/runtime/loop.test.ts`

Expected: FAIL because `completeLocalAsk()` stores `resolvedModels: null`.

**Step 3: Write minimal implementation**

Compute resolved models from the effective model settings for shortcut runs and persist them into the saved run record.

**Step 4: Run test to verify it passes**

Run: `pnpm test test/runtime/loop.test.ts`

Expected: PASS

### Task 4: Verify end state

**Files:**
- Modify: `README.md` if needed for API behavior note

**Step 1: Run focused verification**

Run: `pnpm test test/runtime/loop.test.ts test/model-policy.test.ts test/server/dashboard.test.ts`

Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm type-check`

Expected: PASS
