# Final Delivery Push Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** complete the Shipyard final-delivery path by running a real Ship rebuild on a fresh target repo, fixing blocking agent issues, and updating submission evidence/docs with real results.

**Architecture:** keep the ship-agent repo as the orchestrator and run it against a fresh clone of `ship-refactored` so existing target-repo edits stay untouched. Drive rebuild steps through Shipyard's HTTP API, poll every run, patch Shipyard when it fails, restart, and resume from the failed rebuild step until the target app rebuild is evidence-backed.

**Tech Stack:** TypeScript, LangGraph, Express, WebSocket, curl, jq, git

---

### Delivery Checklist

- Fresh rebuild repo created from `/Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored`
- Shipyard server running against the fresh target repo
- Rebuild instruction pipeline executed for Ship app scope (`03-09`; optional `01` cleanup pass if needed)
- Failures logged with run ids, traces, and retry notes
- Shipyard code patched/restarted for any blocking failures
- Rebuild flow executed at least twice end to end
- Post-rebuild review completed with extra tests added for uncovered gaps
- Submission docs updated to match actual evidence
- Final branch pushed to both GitHub and GitLab
- Remaining final gaps listed explicitly if deployment/demo/social are still open

### Task 1: Create isolated rebuild target

**Files:**
- Create: `/Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final/`

**Step 1: Inspect baseline repo state**

Run: `git -C /Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored status --short`
Expected: may be dirty; do not modify it

**Step 2: Create fresh clone**

Run: `git clone --no-hardlinks /Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored /Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final`
Expected: new standalone git repo

**Step 3: Verify fresh target**

Run: `git -C /Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final status --short`
Expected: clean working tree

### Task 2: Start Shipyard against fresh target

**Files:**
- Modify if needed: `ship-agent/.env`

**Step 1: Install deps if needed**

Run: `pnpm install`
Expected: lockfile-resolved install succeeds

**Step 2: Start server with target workdir**

Run: `SHIPYARD_WORK_DIR=/Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final pnpm dev`
Expected: server starts on configured port

**Step 3: Verify health**

Run: `curl -sf http://localhost:4200/api/health`
Expected: `{"status":"ok"}`

### Task 3: Execute Ship rebuild

**Files:**
- Read: `instructions/03-database-schema-and-migrations.md`
- Read: `instructions/04-auth-and-session-management.md`
- Read: `instructions/05-document-crud-api.md`
- Read: `instructions/06-realtime-collaboration.md`
- Read: `instructions/07-react-frontend-shell.md`
- Read: `instructions/08-tiptap-rich-text-editor.md`
- Read: `instructions/09-file-uploads-and-comments.md`

**Step 1: Run rebuild pipeline**

Run: `SHIPYARD_TARGET=/Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final REBUILD_SKIP_DONE=0 ./scripts/run-rebuild.sh`
Expected: submit/poll each step; stop on first hard failure

**Step 2: Record run ids and trace urls**

Source: `/tmp/ship-rebuild.log`
Expected: each instruction has run id, phase, duration, tokens, trace

**Step 3: On failure, inspect stored run payload**

Run: `curl -sf http://localhost:4200/api/runs/<run-id>`
Expected: full state with messages, error, tool history, file edits

### Task 4: Repair agent blockers

**Files:**
- Modify only the minimal blocking files under `src/` and `test/`

**Step 1: Reproduce the blocking failure locally**

Run: the narrowest relevant `pnpm vitest run ...` or `pnpm type-check`
Expected: fresh failing evidence

**Step 2: Patch Shipyard**

Use surgical edits only; keep changes minimal and evidence-driven.

**Step 3: Re-run targeted verification**

Run: exact failing test/typecheck command
Expected: green for the repaired case

**Step 4: Restart Shipyard**

Run: restart `pnpm dev` with the same `SHIPYARD_WORK_DIR`
Expected: health endpoint returns ok again

**Step 5: Resume rebuild from failed step**

Run: `SHIPYARD_TARGET=/Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final REBUILD_SKIP_DONE=1 ./scripts/run-rebuild.sh`
Expected: already-done steps skipped; failed step retried

### Task 5: Update submission evidence

**Files:**
- Modify: `docs/CODEAGENT.md`
- Modify: `docs/COMPARATIVE.md`
- Modify: `docs/AI-COST.md`
- Modify: `docs/AI-DEV-LOG.md`

**Step 1: Replace aspirational rebuild claims with actual evidence**

Use run ids, traces, duration, and human interventions from the real rebuild log.

**Step 2: Mark unfinished final-delivery items honestly**

Deployment, demo video, and social post stay explicit if still incomplete.

**Step 3: Run gate commands**

Run:
- `pnpm type-check`
- `pnpm test`

Expected: passing output or exact remaining failures documented

### Task 6: Second rebuild and review pass

**Step 1: Re-run the rebuild flow**

Run: `SHIPYARD_TARGET=/Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final SHIPYARD_PORT=4210 REBUILD_SKIP_DONE=0 ./scripts/run-rebuild.sh`
Expected: the pipeline completes a second time or exposes deterministic regressions

**Step 2: Review run deltas and target repo changes**

Source:
- `/tmp/ship-rebuild.log`
- `git -C /Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final status --short`
- `curl -sf http://localhost:4210/api/runs`

Expected: clear evidence that the second pass was executed and polled

**Step 3: Add more tests for gaps found in the second pass**

Run: targeted `pnpm vitest run ...` for the bug area, then full `pnpm test`
Expected: newly added tests cover the failure/regression class

### Task 7: Final verification

**Step 1: Verify Shipyard server still runs**

Run: `curl -sf http://localhost:4200/api/health`
Expected: ok

**Step 2: Verify rebuild repo changed materially**

Run: `git -C /Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-final status --short`
Expected: substantial app changes from rebuild steps

**Step 3: Verify docs reflect reality**

Run: review `docs/CODEAGENT.md` blocked/not-started sections and rebuild log
Expected: no contradiction between docs and evidence

**Step 4: Push final repo state**

Run: `git push origin <branch>`
Expected: pushes to both GitHub and GitLab because `origin` has both push URLs configured
