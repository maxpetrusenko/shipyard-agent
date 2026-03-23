# Comparative Analysis

> Shipyard autonomous coding agent: what we built, what worked, what failed, and what we would change.

---

## 1. Executive Summary

Ship-agent is a LangGraph-based autonomous coding agent that decomposes natural-language instructions into multi-step plans, executes them via surgical file edits, verifies correctness through automated typecheck and test runs, and gates quality with an Opus-powered review loop. The architecture routes Opus 4.6 for planning and review (high reasoning) and Sonnet 4.5 for execution and verification (speed), connected through a 6-node state graph: plan, execute, verify, review, error_recovery, and report. File editing uses a 4-tier anchor-based cascade (exact match, whitespace-normalized, fuzzy Levenshtein, full rewrite) implemented in 252 lines of TypeScript. Multi-agent coordination follows a supervisor/worker pattern with conflict detection and merge logic. The rebuild of the Ship app was directed entirely through this agent, with 9 structured instruction files covering strict TypeScript, tool modularization, database schema, auth, CRUD APIs, realtime collaboration, React frontend, rich-text editing, and file uploads. The agent produced approximately 4,058 lines of source code across 38 files, backed by 248 test cases across 18 test files. The process exposed real limitations: the agent under-completed broad codebase-wide tasks, struggled with cross-file refactors, and the bench harness had persistent shell-scripting failures. These are documented honestly below.

---

## 2. Architectural Comparison

### Agent-built structure vs. human-authored original

The original Ship app was a monorepo with `shared`, `api`, and `web` packages. A human architect would design the full module boundary map upfront: shared types in one package, API routes in another, frontend components in a third, with a single coherent schema connecting all three.

The agent-built version, by contrast, emerged incrementally. Each instruction file (`01-strict-typescript.md` through `09-file-uploads-and-comments.md`) produced a locally correct change, but the global architecture was a byproduct of instruction ordering, not deliberate holistic design.

**Specific differences a human would not produce:**

1. **Vertical slicing vs. horizontal layering.** The agent processes instructions top-to-bottom: "add database schema" produces schema files, then "add auth" produces auth files. A human would instead design the data model, auth model, and API surface together, then implement them. The agent's approach creates more rework when later instructions conflict with earlier decisions.

2. **File-by-file editing vs. cross-cutting refactors.** The agent's `edit_file` tool operates on one file at a time (see `src/tools/edit-file.ts`). When a type changes in `shared/`, the agent must separately update every importing file. A human using IDE refactoring would rename across all files atomically. Evidence: the plan node (`src/graph/nodes/plan.ts`, line 26-56) explicitly instructs the agent to "use grep/glob to find EVERY file affected" because the natural mode is to edit one or two files and declare victory.

3. **Defensive prompting over defensive code.** The review node (`src/graph/nodes/review.ts`, lines 17-37) contains extensive completeness heuristics in the system prompt: "If the instruction says 'all files' but only 1-3 were edited, that is INCOMPLETE." A human developer does not need prompt engineering to remember to check all files. This defensive layer exists because the agent, left unchecked, stops after touching one or two files on codebase-wide tasks.

4. **Flat file structure.** The agent created 38 source files organized into `graph/`, `tools/`, `multi-agent/`, `config/`, `server/`, `runtime/`, and `context/` directories. This is a reasonable structure, but it was assembled directory-by-directory as features were added, not designed upfront. A human would likely co-locate related concerns differently (e.g., keeping `hooks.ts` and `file-overlay.ts` inside the `graph/` directory rather than `tools/`, since they serve graph execution).

5. **No shared type package.** The agent did not create a separate `types/` or `shared/` package for interfaces used across modules. Instead, `src/graph/state.ts` exports types (`FileEdit`, `ToolCallRecord`, `ContextEntry`) that are imported by tools, multi-agent modules, and server code. A human designing for a monorepo would extract these into a standalone package to enforce dependency direction.

### What the agent got right

The LangGraph state annotation pattern (`src/graph/state.ts`) cleanly separates concerns: 24 state fields covering identity, phase tracking, plan steps, execution history, verification results, review decisions, context injection, error tracking, and telemetry. This is well-structured and would not look out of place in a human-authored codebase.

The conditional edge routing (`src/graph/edges.ts`) is minimal and correct: 3 functions, 52 lines, mapping review decisions to graph transitions. No over-engineering.

---

## 3. Performance Benchmarks

### Agent execution metrics

| Metric | Value | Source |
|--------|-------|--------|
| Source code produced | 4,058 LOC across 38 files | `wc -l src/**/*.ts` |
| Test cases | 248 across 18 test files | `grep -c 'it(\|test(' test/**/*.test.ts` |
| Baseline target tests (Ship) | 721 passing | `results/baseline.json` |
| Type-check status | Clean (`pnpm type-check` passes) | Verify node runs `pnpm type-check 2>&1` on every cycle |
| Instruction files | 9 structured tasks | `instructions/*.md` |
| Bench runs recorded | 35 result files | `results/*.json` |

### Edit tier distribution (design target vs. observed)

The 4-tier cascade (`src/tools/edit-file.ts`) was designed so that Tier 1 (exact match) handles the vast majority of edits, with Tiers 2-3 as silent recovery and Tier 4 as a safety net.

| Tier | Mechanism | Design Target | Observed Behavior |
|------|-----------|---------------|-------------------|
| 1 | Exact string match | 80%+ | Majority of edits during development hit Tier 1. LLM output with correct indentation matches exactly. |
| 2 | Whitespace-normalized | 10-15% | Catches indentation mismatches. Most common failure mode: LLM uses 2-space indent, file uses 4-space. |
| 3 | Fuzzy (Levenshtein < 10%) | 3-5% | Rare. Triggered by minor character differences in copied code. |
| 4 | Full rewrite | < 2% | Used for new file creation and occasionally when the agent fails to locate the target block. |

Exact percentages are not logged per-run in production (the `tier` field is recorded in `FileEdit` but not aggregated). This is a telemetry gap. The tier distribution is estimated from development observation and test behavior.

### Execution speed

| Task Type | Typical Duration | Notes |
|-----------|-----------------|-------|
| Single-file edit | 30-90 seconds | Plan (1 tool round) + execute (2-5 tool rounds) + verify + review |
| Multi-file feature | 2-5 minutes | 3-10 step plan, each step executing 2-8 tool rounds |
| Codebase-wide change | 5-15 minutes | 10-30 step plan, multiple grep/glob exploration rounds in planning |
| Full bench run (with setup) | 3-10 minutes | Includes target reset, server startup, polling |

Manual development speed comparison: a senior developer would implement a single-file change in 5-15 minutes (including reading, thinking, editing, testing). The agent's 30-90 second time for single-file edits is a genuine speed advantage, but for multi-file features, the agent's 2-5 minutes is comparable to a developer who knows the codebase well.

### Cost (under Max plan)

Development cost: $0 incremental (Claude Max plan, flat-rate subscription). All 50+ agent runs during development were covered by the subscription.

Per-run token consumption (estimated from model policy and run structure):
- Planning phase: ~5K-15K input tokens (system prompt + codebase exploration), ~1K-3K output tokens
- Execution phase: ~3K-8K input per tool round, ~1K-2K output per tool round, 2-8 rounds per step
- Review phase: ~3K input, ~500 output
- Total per single-file edit: ~15K-30K input, ~5K-10K output
- Total per multi-file feature: ~50K-150K input, ~20K-50K output

At standard API pricing (not Max plan): a single-file edit costs approximately $0.05-0.15, a multi-file feature costs $0.30-1.50.

---

## 4. Shortcomings

### 4.1 Under-completion of broad tasks

The most persistent failure mode. When given an instruction like "enable strict TypeScript across the codebase," the agent would:
1. Find 1-3 files via grep
2. Edit those files
3. Declare `STEP_COMPLETE`
4. Pass review (if the review prompt was not sufficiently defensive)

This required adding extensive completeness heuristics to both the plan prompt (`src/graph/nodes/plan.ts`, lines 24-56, the "CRITICAL: Be EXHAUSTIVE" section) and the review prompt (`src/graph/nodes/review.ts`, lines 17-37, the "CRITICAL: Check for COMPLETENESS" section). Even with these guardrails, the `01-strict-typescript` benchmark required 7+ runs before producing acceptable coverage, as evidenced by the 7 separate `bench-01-strict-typescript-*.json` result files.

**Root cause**: The agent optimizes locally. Each tool call loop has a completion incentive (`STEP_COMPLETE` signal). The agent satisfies the immediate step, not the global instruction. This is a fundamental limitation of instruction-following agents operating on per-step state.

### 4.2 bench.sh JSON serialization failures

The benchmark harness (`scripts/bench.sh`) had repeated failures writing result JSON. The `jq --argjson` flag requires clean integer inputs, but shell variable extraction from `grep` and `wc` output produced multi-line strings, trailing newlines, and empty values that broke `jq`.

The fix required adding a `sanitize_int()` function (line 5-9) that extracts the last integer from any string, plus a fallback JSON writer (lines 264-273) that produces valid JSON even when `jq` fails. This took 7 iterations of the bench script (visible in commit history and the 7 `bench-01-strict-typescript-*` result files).

**Evidence**: The `set +e` guard around the `jq` call (line 259) and the `JQ_ERR` capture pattern (line 213) are defensive workarounds that would not exist in a cleanly-designed script. This is a case where AI-generated bash was the least reliable output category.

### 4.3 Cross-file refactors

The agent cannot perform atomic cross-file renames. The `edit_file` tool (`src/tools/edit-file.ts`) operates on a single file. When renaming a type from `FooBar` to `BazQux`, the agent must:
1. Edit the definition file
2. Separately find and edit every importing file
3. Hope nothing breaks between edits

A human developer using TypeScript's `F2` rename refactoring does this atomically. The agent's approach is fragile: if step 2 misses a file, or if the renamed type appears in string literals or comments, the agent leaves inconsistencies.

### 4.4 Limited single-pass codebase understanding

The plan node (`src/graph/nodes/plan.ts`) explores the codebase via tool calls (read_file, grep, glob, ls). It has 30 tool rounds (line 97) to build its understanding. For a codebase with 38 source files, this is sufficient. For a larger codebase (500+ files), the agent would need to read selectively, and its file selection is guided by grep patterns that may miss relevant code.

The agent has no persistent codebase index. Every new instruction starts fresh. It cannot say "I know from previous runs that the database types are in `shared/types/database.ts`." Context injection partially addresses this (the `contexts` field in state), but injected context is ephemeral and must be re-provided.

### 4.5 OAuth and environment edge cases

The Anthropic client (`src/config/client.ts`) handles OAuth token retrieval from macOS Keychain and environment variable configuration. This was the area requiring the most manual debugging: environment variable naming (modern `LANGSMITH_*` vs legacy `LANGCHAIN_*`), Keychain access permissions, and Doppler secret injection all required human intervention that the agent could not resolve.

### 4.6 Review node false positives

The review node sometimes approves incomplete work when the verification (typecheck + tests) passes. Typecheck passing does not mean the instruction was fully satisfied. The review prompt attempts to catch this with completeness heuristics, but Opus can be convinced by a partial implementation that "looks done" if the remaining work would not cause type errors.

### 4.7 No streaming output

The server returns results only after the full run completes. During a 5-15 minute codebase-wide task, the user sees only polling phase updates ("planning", "executing", "verifying"). There is no streaming of individual tool calls or partial results. The WebSocket handler (`src/server/ws.ts`) supports `state_update` messages, but the graph nodes do not emit incremental updates mid-execution.

---

## 5. Advances

### 5.1 Parallel subagent execution

The coordinate node (`src/graph/nodes/coordinate.ts`, lines 91-96) dispatches independent workers via `Promise.all`:

```typescript
const parallelResults = await Promise.all(
  independent.map((task) =>
    runWorker(task.id, task.description, state.contexts),
  ),
);
```

Each worker (`src/multi-agent/worker.ts`) gets its own conversation history, FileOverlay, and recording hooks (lines 96-99). Workers cannot contaminate each other's state. When 8 independent subtasks are identified, 8 workers execute simultaneously, each with isolated context windows.

The merge module (`src/multi-agent/merge.ts`) detects conflicts at two levels: file-level (multiple workers touched the same path) and region-level (edits to the same file overlap via substring containment or shared-line detection, lines 103-119). Non-overlapping edits to the same file merge safely; true overlaps keep the first worker's edit and flag the rest for replan.

A human developer cannot parallelize themselves across 8 files. This is a genuine capability advantage.

### 5.2 Consistent code style

Every file in `src/` follows the same patterns: JSDoc block comment at the top explaining the module's purpose, explicit TypeScript interfaces for all parameters and return types, named exports, no default exports, consistent error handling. This consistency is a natural byproduct of LLM generation from the same system prompt. A team of human developers would need linting rules and code review to achieve comparable uniformity.

### 5.3 Exhaustive test generation

248 test cases across 18 test files. The agent generates edge-case tests that a human might skip: empty string inputs, multiple match scenarios, file-not-found paths, malformed JSON recovery, WebSocket invalid frames. The `test/tools/bash.test.ts` file alone has 22 test cases covering every blocked pattern (`rm -rf /`, fork bombs, pipe-into-sh, etc.).

The test generation is fast because the agent can produce test scaffolding in one tool-call round. A human writing 22 bash safety tests would spend 30-60 minutes; the agent generates them in one execution cycle.

### 5.4 Zero typos in boilerplate

No misspelled variable names, no mismatched bracket counts, no off-by-one errors in string templates. The boilerplate code (Express routes, WebSocket handlers, Zod schemas, state annotations) is mechanically correct. Typos in boilerplate are a real time cost in manual development; the agent eliminates this class of error entirely.

### 5.5 Structured documentation generation

PRESEARCH.md (1209 lines), CODEAGENT.md (366 lines), and AI-DEV-LOG.md (183 lines) were all generated through agent sessions. The documentation is comprehensive, internally consistent, and includes concrete code examples, interface definitions, and decision rationale. A human writing this volume of documentation would spend a full day; the agent produced it as a side effect of the development conversation.

### 5.6 Hook-based instrumentation

The tool hooks system (`src/tools/hooks.ts`, 163 lines) cleanly separates recording, cost tracking, and logging from tool execution logic. The `createRecordingHooks` function (line 64) produces a hook pair that records `FileEdit[]` and `ToolCallRecord[]` without the execute node needing any recording logic. This is a well-factored abstraction that a human developer might not invest time in during a one-week sprint.

---

## 6. Trade-off Analysis

### 6.1 Opus for planning/review vs. cheaper model

**Decision**: Use Opus 4.6 ($15/M input, $75/M output) for planning and review; Sonnet 4.5 ($3/M input, $15/M output) for execution and verification.

**Defined in**: `src/config/model-policy.ts`, lines 14-40.

**Was it the right call?** Yes. The planning phase requires multi-step reasoning: read the instruction, explore the codebase via tool calls, identify all affected files, decompose into ordered steps. Sonnet produces narrower plans (fewer files, fewer steps) that lead to the under-completion problem described in Section 4.1. Opus plans are more thorough, especially for codebase-wide tasks.

The review phase benefits from Opus for the same reason: it must judge whether the instruction was *fully* satisfied, not just whether the code compiles. Sonnet tends to approve partial implementations.

**Cost impact**: On Max plan, zero incremental cost. On standard API pricing, Opus calls represent approximately 20% of total calls but 60% of total cost. This split is worth it: saving $0.10 per run by downgrading review would increase the retry rate and total cost.

**What would change**: If targeting cost-sensitive production use, the fast-path review optimization (line 50 of `review.ts` skips Opus when steps remain and verification passed) could be extended. Most runs hit the fast path for intermediate steps, only invoking Opus on the final review.

### 6.2 Anchor-based editing vs. AST-based editing

**Decision**: Anchor-based string replacement (`edit_file(path, old_string, new_string)`) with 4-tier fallback cascade.

**Defined in**: `src/tools/edit-file.ts`, 252 lines.

**Was it the right call?** Yes, for this project. AST-based editing would require a TypeScript parser (ts-morph or the TypeScript compiler API), adding ~50K LOC of dependencies. It would be more precise for TypeScript files but would not work for JSON, YAML, Markdown, shell scripts, or any other file type the agent edits.

Anchor-based replacement is language-agnostic, simple to implement (252 lines including all 4 tiers), and matches the approach proven in production by Claude Code, OpenCode, and Aider. The 4-tier cascade adds robustness without complexity: Tier 2 (whitespace normalization) catches the most common LLM failure mode (indentation mismatch) in 27 lines of code.

**Limitation**: Anchor-based editing cannot express structural operations like "move this function to another file" or "extract this block into a new function." These require the agent to manually copy-paste via read_file + edit_file + write_file, which is fragile and verbose. AST editing would handle these natively.

**What would change**: For a production agent targeting only TypeScript codebases, a hybrid approach would be worth exploring: anchor-based for simple edits (90%+ of cases), AST-based for structural refactors (rename, move, extract). The tool dispatch could route based on edit complexity.

### 6.3 Sequential step execution vs. parallel execution

**Decision**: Steps execute sequentially by default. Multi-agent parallel execution is available via the coordinate node but is gated by file independence checks.

**Defined in**: `src/graph/nodes/coordinate.ts`, `shouldCoordinate()` function (lines 29-48).

**Was it the right call?** Yes for MVP. Sequential execution is deterministic: step N completes before step N+1 starts, so step N+1 can read files modified by step N. Parallel execution introduces conflict detection and merge complexity (the entire `src/multi-agent/merge.ts` module exists for this).

The `shouldCoordinate()` gate is conservative: it requires at least 2 steps with zero file overlap. In practice, most plans have file dependencies between steps (step 1 creates a type, step 2 imports it), so the gate rarely triggers. This means parallel execution is available but underutilized.

**What would change**: Git worktree isolation (each worker gets its own worktree, supervisor merges via `git merge`) would enable parallel execution even when workers touch overlapping files. This was noted in PRESEARCH.md but not implemented. It would increase setup complexity but unlock genuine parallelism for large tasks.

### 6.4 LangGraph vs. custom agent loop

**Decision**: Use LangGraph's `StateGraph` with typed annotations, conditional edges, and built-in checkpointing.

**Defined in**: `src/graph/builder.ts`, 92 lines.

**Was it the right call?** Yes. LangGraph provides three things that would be expensive to build from scratch:

1. **Tracing**: Every node transition, tool call, and LLM invocation is automatically traced to LangSmith. Zero instrumentation code required. This was essential for debugging the agent (see AI-DEV-LOG.md: "Debugging agent behavior without tracing is guesswork").

2. **State management**: The `Annotation.Root` pattern (`src/graph/state.ts`) provides typed state with automatic serialization. Adding a new state field is one line of code.

3. **Conditional edges**: The `addConditionalEdges` API (`src/graph/builder.ts`, lines 61-83) expresses the review decision routing cleanly. In a custom loop, this would be a switch statement buried in the main loop body.

**Limitation**: LangGraph's TypeScript SDK was less mature than the Python SDK during development. Some patterns (parallel dispatch via `Send()`, typed state annotations) required reading source code rather than relying on documentation. The `coordinateNode` had to implement its own `Promise.all` rather than using LangGraph's native `Send()` because the TypeScript API for `Send()` was underdocumented.

**Cost**: `@langchain/langgraph` and `@langchain/core` add approximately 15MB to `node_modules`. This is acceptable for a server-side agent but would be excessive for a CLI tool.

### 6.5 Verify node: typecheck-first, test-only-if-clean

**Decision**: The verify node (`src/graph/nodes/verify.ts`) runs `pnpm type-check` first. If typecheck fails, it skips tests entirely (lines 36-51).

**Was it the right call?** Mostly. Type errors almost always mean tests will fail too, so skipping tests saves 10-30 seconds per failed verification cycle. Over a 10-step plan with 2-3 retries, this saves 1-3 minutes.

**Limitation**: This misses the case where typecheck passes but tests reveal a behavioral regression. The agent edits a function body without changing its signature: typecheck passes, but the function now returns wrong values. The review node is supposed to catch this, but it can only inspect the test *output*, not run additional targeted tests. A more thorough verification would run tests even when typecheck passes but the edit touched non-type code.

---

## 7. If You Built It Again

### 7.1 Start with prefix caching from day 1

The system prompt structure for maximum cache hits was designed in PRESEARCH.md (the "Prefix Caching Design" section) but was not implemented from the first working prototype. The `wrapSystemPrompt()` function in `src/config/client.ts` could have included `cache_control: { type: 'ephemeral' }` blocks from the start. Adding caching later required auditing every LLM call site to ensure the static prefix was consistent.

Prefix caching matters even on Max plan: cached prefixes process faster (lower latency) and consume less rate limit headroom (more throughput for multi-step runs).

### 7.2 Implement context compaction earlier

The context compaction mechanism (structured summary using the OpenCode pattern, described in PRESEARCH.md Section 9) was designed but not fully wired into the runtime loop. For runs with 10+ execution cycles, the conversation history grows and eventually hits the context window. The `checkBudget()` function was designed (`PRESEARCH.md`, lines 766-773) but compaction was deferred as a post-MVP feature.

In hindsight, compaction should have been implemented alongside the verify-retry loop, because retry loops are the primary source of context bloat: each retry adds the full plan, execute, verify, and review conversation to the history.

### 7.3 Use git worktrees for worker isolation

The multi-agent workers (`src/multi-agent/worker.ts`) share the same filesystem. Worker A edits `foo.ts`, Worker B reads `foo.ts` mid-edit, Worker B gets corrupted state. The `FileOverlay` (`src/tools/file-overlay.ts`) provides rollback but not isolation.

Git worktrees would give each worker a clean copy of the repository. The supervisor merges via `git merge` after all workers complete. This is how Claude Code handles multi-agent coordination (noted in PRESEARCH.md: "Claude Code and Cursor use isolated git worktrees for multi-agent work").

The worktree approach was explicitly deferred to "Phase 6" in the original design. In retrospect, it should have been Phase 3, implemented before the merge module. The current merge logic (`src/multi-agent/merge.ts`, 194 lines) would be unnecessary with worktree isolation because `git merge` handles conflict detection and resolution natively.

### 7.4 Build a proper CLI instead of REST-only

The agent is accessible only via REST API (`POST /api/run`) and WebSocket (`/ws`). There is no CLI interface. During development, every interaction required `curl` commands or the bench script. A simple CLI (`shipyard run "enable strict typescript"`) would have accelerated iteration by 2-3x.

The CLI could also support `--watch` mode (re-run on file changes), `--dry-run` (show plan without executing), and `--interactive` (approve each step). These modes are natural for a CLI but awkward to retrofit onto a REST API.

### 7.5 Add streaming output

The current architecture completes the full graph before returning results. The WebSocket handler supports `state_update` messages, but nodes do not emit incremental updates. A 10-minute run produces no feedback until completion.

LangGraph supports streaming via `app.stream()`. Each node transition and tool call can be streamed to the client as it happens. This would require changing from `app.invoke()` to `app.stream()` in the runtime loop and wiring the stream events to the WebSocket handler.

### 7.6 Persistent codebase index

Every instruction starts with the plan node exploring the codebase from scratch. For a familiar codebase (like the Ship repo that the agent rebuilds repeatedly), this exploration is wasted work. A persistent index mapping file paths to summaries, exported symbols, and dependency relationships would let the plan node skip exploration for known files.

The context injection mechanism (`contexts` field in state, `inject_context` tool) provides the primitives for this: inject a "codebase map" context at run start. But the map must be built and maintained manually. An automatic indexer that updates on file change would be the proper solution.

### 7.7 Better telemetry aggregation

The `FileEdit` type records the `tier` field (1-4) for every edit, but there is no aggregation dashboard. The numbers in Section 3 (edit tier distribution) are estimates, not measurements. Adding a simple aggregation (count edits by tier per run, track over time) would provide the data needed to evaluate whether the 4-tier cascade is working as designed or if one tier is doing all the heavy lifting.

Similarly, retry counts, review decisions, and verification pass rates are logged in state but not aggregated across runs. A `POST /api/analytics` endpoint that queries the `shipyard_runs` table for aggregate metrics would close this gap.

### 7.8 Separate planning from file discovery

The plan node currently does both: it explores the codebase (grep, glob, read_file) AND produces the step plan. These are different cognitive tasks. A dedicated "explore" node that runs first, builds a codebase summary, and passes it to the plan node would reduce planning token consumption and improve plan quality.

This matches the three-phase loop from Claude Code (gather context, take action, verify results). Our current plan node conflates "gather context" and "take action" into a single LLM call with 30 tool rounds.
