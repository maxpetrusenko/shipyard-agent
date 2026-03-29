# Ship Agent: Rebuild Benchmark & Demo Plan

> **Goal**: Fix multi-agent merge conflicts, run a clean Ship rebuild, produce a polished 1-3 min demo video, deploy the rebuilt app.
>
> **Deadline**: Final submission (Sunday 11:59 PM)

---

## Phase 1: Fix Multi-Agent Merge Conflicts

### Root Cause (from codebase analysis)

The 137-edit rebuild run died with `Max retries (8) exceeded. Execution issue (coordination): Coordinator merge conflicts on .../api/src/routes/files.ts`. The failure chain:

1. **`collectSubtaskFiles` is blind**: Only captures files explicitly listed in `task.files[]` or regex-matched absolute paths in the description. If the supervisor LLM assigns `files.ts` to a subtask without listing it, two workers get dispatched in parallel against the same file.
2. **`coordinateNode` conflicts-only branch doesn't set `executionIssue`**: Line 377-385 logs the conflict but returns `executionIssue: null`. The reviewer LLM infers the conflict from message history, retries with the same plan, hits the same conflict 8 times, then escalates.
3. **`mergeEdits` first-writer-wins drops valid edits**: Overlapping file = entire second worker's edits silently dropped. No attempt to reconcile non-overlapping regions within the same file.
4. **Workers share the physical filesystem**: Two parallel workers both read the original file, both write their changes, second clobbers first on disk. `FileOverlay` only rolls back on worker error, not on sibling collision.

### Fix Plan (3 changes, ordered by impact)

#### Fix 1A: Conflict-aware serialization fallback (coordinate.ts)
**File**: `src/graph/nodes/coordinate.ts:377-413`

When `hasConflicts && errors.length === 0`:
- Set `executionIssue` with `kind: 'coordination'`, `recoverable: true`
- Set `nextAction: 'Re-run with single-agent execution (disable multi-agent for this instruction)'`
- On retry (retryCount >= 1 for same conflict), automatically switch to sequential single-agent execution by setting a state flag `forceSequential: true`
- When `forceSequential` is true, `coordinateNode` skips decomposition entirely and runs the full instruction as a single worker

**Why**: Breaks the infinite retry loop. First attempt tries parallel, if conflict detected, second attempt goes sequential. No more 8x retry waste.

#### Fix 1B: Git worktree isolation for parallel workers (worker.ts + coordinate.ts)
**File**: `src/multi-agent/worker.ts`, `src/graph/nodes/coordinate.ts`

Before dispatching parallel workers:
1. Each worker gets its own git worktree: `git worktree add /tmp/shipyard-worker-<id> -b shipyard-worker-<id>`
2. Worker operates in its isolated worktree directory
3. After all workers complete, merge branches sequentially into the main working tree
4. If git merge conflicts arise, attempt auto-resolution with `git merge -X theirs` for non-overlapping hunks
5. Clean up worktrees: `git worktree remove`

**Why**: Physical filesystem isolation eliminates the disk-clobber race. Git's merge machinery handles the reconciliation instead of our heuristic `editsOverlap`.

**Tradeoff**: Adds ~2-3s overhead per worker (worktree create + merge). Worth it for correctness.

#### Fix 1C: Smarter file detection in supervisor prompt (supervisor.ts)
**File**: `src/multi-agent/supervisor.ts`

Enhance the `DECOMPOSE_SYSTEM` prompt to require explicit `files` arrays:
```
CRITICAL: Every subtask MUST list ALL files it will read or write in the "files" array.
Include files the task will likely need to modify based on imports, routes, and shared modules.
If two subtasks share ANY file, mark them as a sequential_pair.
```

Also add a post-decomposition validation: scan each subtask's description for relative paths (e.g., `routes/files.ts`, `src/services/auth.ts`) and add them to `task.files` automatically.

**Why**: Better file detection = better pre-dispatch serialization = fewer conflicts reaching `mergeEdits`.

### Tests to Add
- `test/multi-agent/merge-conflict-fallback.test.ts`: Verify that conflict on first attempt triggers `forceSequential` on retry
- `test/multi-agent/worktree-isolation.test.ts`: Verify parallel workers in worktrees don't clobber each other
- Update `test/multi-agent.test.ts` with regression case for the `files.ts` scenario

### Success Criteria
- [ ] The 7-instruction rebuild (`run-rebuild.sh`) completes all steps with `phase=done`
- [ ] No `Coordinator merge conflicts` errors in the rebuild log
- [ ] All existing tests pass (226+)

---

## Phase 2: Run PRD-Based Rebuild & Record

### 2A: Execute the Rebuild

```bash
cd /Users/maxpetrusenko/Desktop/Gauntlet/ship-agent

# Reset target to clean baseline
./scripts/setup-target.sh

# Start server
pnpm dev &

# Run all 7 instructions sequentially
LANGCHAIN_TRACING_V2=true ./scripts/run-rebuild.sh 2>&1 | tee /tmp/ship-rebuild-final.log
```

**Capture during run**:
- Terminal output via `asciinema rec /tmp/ship-rebuild.cast`
- Wall-clock time per instruction (already logged by `run-rebuild.sh`)
- LangSmith trace URLs (already captured in run results)
- Token usage and cost per step

### 2B: Post-Rebuild Verification

```bash
cd /Users/maxpetrusenko/Desktop/Gauntlet/ship-refactored

# Typecheck
pnpm type-check

# Tests
pnpm test

# Build
pnpm build

# Start the rebuilt app
docker compose up -d  # or direct node start

# Smoke test
curl http://localhost:3000/api/health
```

Document: files changed, LOC delta, test pass rate, typecheck status, build size.

### 2C: Deploy the Rebuilt App

Deploy `ship-refactored` to a public URL (Hostinger VPS or similar). This is a submission requirement: "agent-built Ship app publicly accessible."

### 2D: Record the Demo Video

**Option A (fastest): asciinema + ffmpeg**
```bash
# Record the rebuild run
asciinema rec --cols 120 --rows 35 /tmp/rebuild-demo.cast

# Convert to MP4
# Use agg (asciinema gif generator) or asciinema-player embedded in HTML + screen capture
# Speed up middle sections with ffmpeg
ffmpeg -i rebuild-raw.mp4 -vf "setpts=0.25*PTS" -an rebuild-fast.mp4
```

**Option B (polished): Remotion pipeline**
```bash
npm init video -- --template asciinema-mp4
# Drop the .cast file in, configure speed map, render
npx remotion render src/index.ts RebuildDemo rebuild-demo.mp4
```

### Demo Script (1-3 min)

| Timestamp | Content | Speed |
|-----------|---------|-------|
| 0:00-0:15 | "Ship Agent rebuilds Ship from a PRD." Show the instruction file. | 1x |
| 0:15-0:25 | Start `run-rebuild.sh`. Show planning output. | 1x |
| 0:25-1:30 | Agent executing: file edits, tool calls, verification. | 4-8x |
| 1:30-1:50 | Tests passing. Typecheck green. | 1x |
| 1:50-2:10 | Open rebuilt app in browser. Navigate features. | 1x |
| 2:10-2:30 | Show LangSmith trace. Metrics overlay (time, cost, edits). | 1x |
| 2:30-2:45 | Side-by-side: original Ship vs rebuilt Ship. | 1x |

---

## Phase 3: Alternative Demo/Benchmark Options

### Option A: Live Dashboard Replay (recommended if demo can be 3 min)

**How**: Open `agent.ship.187.77.7.226.sslip.io/dashboard`, submit a single scoped instruction live (e.g., `03-database-schema-and-migrations`), watch plan/execute/verify in real-time via WebSocket streaming.

**Pros**: Most authentic. Dashboard already renders Streamdown markdown in real-time. Audience sees the actual product.
**Cons**: Depends on API latency (~5-12s per LLM call). Risk of rate limit or slow response.
**Mitigation**: Pre-warm the server. Pick the shortest instruction. Have a pre-recorded fallback.

**Metrics to show**: Wall-clock time, token cost, edit tier distribution, LangSmith trace link.

### Option B: Before/After Split-Screen Comparison

**How**: Record two panes side by side:
- Left: Original Ship app running (the hand-built version)
- Right: Agent-rebuilt Ship app running (from `ship-refactored`)

Walk through 3-4 features (auth, documents, realtime collab) showing functional parity. Overlay diff stats, test counts, cost.

**Pros**: Instantly legible. No narration needed. The visual comparison IS the argument.
**Cons**: Requires the rebuilt app to actually work end-to-end. Doesn't show the agent in action.
**Best for**: Async viewing, social media posts, submission proof.

### Option C: Benchmark Scorecard + Trace Deep-Dive

**How**: Show a static results dashboard (can build in the existing `/benchmarks` page) with:
- 7 instructions, each with: duration, phase, edits, tokens, cost, trace URL
- Aggregate: total time, total cost, total edits, test delta
- Click into one trace to show the full plan-execute-verify-review cycle

**Pros**: Most data-rich. Shows engineering rigor. The `/benchmarks` page already exists.
**Cons**: Not as visually compelling as watching the agent work. Better for async review than live demo.
**Best for**: Professor/evaluator audience who wants proof over polish.

### Recommendation

**For 1-3 min live demo**: Option A (Dashboard Replay) with a pre-recorded Option B fallback.
**For submission proof**: Option C (Benchmark Scorecard) as a static artifact alongside the video.

---

## Implementation Order

```
Day 1 (today):
  [1] Fix 1A: forceSequential fallback (coordinate.ts) ............. ~2h
  [2] Fix 1C: supervisor prompt + auto-detect files ................ ~1h
  [3] Run tests, verify fixes .................................... ~30m

Day 2:
  [4] Fix 1B: git worktree isolation (if time allows) .............. ~3h
  [5] Run full rebuild (run-rebuild.sh) ............................ ~1-2h wall clock
  [6] Post-rebuild verification + fix any failures ................. ~1h

Day 3:
  [7] Deploy rebuilt app .......................................... ~1h
  [8] Record demo video (asciinema + ffmpeg or Remotion) ........... ~2h
  [9] Write comparative analysis .................................. ~2h
  [10] Final submission checklist .................................. ~1h
```

### Critical Path

Fix 1A (forceSequential) unblocks the rebuild. Everything else depends on a clean rebuild completing. If worktree isolation (Fix 1B) takes too long, skip it -- the forceSequential fallback is sufficient for the rebuild benchmark.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/graph/nodes/coordinate.ts` | Add `forceSequential` check, set `executionIssue` on conflicts |
| `src/graph/state.ts` | Add `forceSequential` annotation |
| `src/multi-agent/supervisor.ts` | Enhance prompt, add file auto-detection |
| `src/multi-agent/worker.ts` | (Phase 1B only) Git worktree create/cleanup |
| `src/multi-agent/merge.ts` | No changes needed if worktree approach works |
| `test/multi-agent.test.ts` | Add regression tests |
| `scripts/run-rebuild.sh` | No changes needed |

## Risk Mitigation

- **Rebuild still fails after fixes**: Fall back to sequential-only mode (set `forceSequential: true` as default). Slower but guaranteed no conflicts.
- **Remotion setup too slow**: Use ffmpeg + OBS screen recording. 30 min vs 4 hours.
- **Rebuilt app doesn't deploy**: Deploy with `docker compose` on the existing Hostinger VPS alongside the agent.
- **Time pressure**: Fix 1A alone is sufficient. Skip 1B and Remotion if needed.
