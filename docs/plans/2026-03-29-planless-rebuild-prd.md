# Planless Rebuild Mode PRD

**Date:** 2026-03-29

## Goal

Shipyard should support a rebuild mode where the user supplies the plan up front and the agent executes it directly. In this mode, Shipyard does not spend tokens creating or revising a plan unless the user explicitly asks for planning help in a separate run.

## Problem

Today Shipyard still carries planner-era assumptions even though the strongest rebuild path is now orchestrator-first worker execution. For rebuild work, planning is usually already done outside the agent: instruction packs, PRDs, wireframes, checklists, and human sequencing decisions already exist. Recomputing that plan inside Shipyard costs tokens, creates drift, and introduces another failure surface.

At the same time, benchmark truth is split across raw run JSON, rebuild logs, issue truth, and generated markdown. `docs/benchmarks.md` currently favors recency, not best verified evidence, so it is weak as a decision surface.

## Product Decision

Add a **planless execution mode** for rebuilds.

In planless mode:

- the user submits a structured execution plan
- Shipyard validates the plan shape and scope before starting
- the graph skips `planNode`
- the orchestrator executes the supplied steps directly
- worker agents implement one vertical slice at a time
- deterministic verification runs after every worker step
- a final rebuild gate determines whether the rebuild is truly complete

Planning remains available as a separate thread kind or tool, but it is no longer part of the default rebuild execution path.

## Users

### Primary user

Max, running Ship rebuild campaigns and using Shipyard as the execution engine, not the product thinker.

### Secondary user

Anyone benchmarking the agent against a target app rebuild and needing stable, replayable execution against an externally authored spec.

## User Stories

1. As an operator, I want to attach a rebuild plan and have the agent execute it exactly, so I can control sequencing outside the agent.
2. As an operator, I want PRD and wireframe docs attached to the run, so worker agents can reference product intent without inventing it.
3. As an operator, I want the benchmark page to show the best verified evidence, not just the latest noisy attempts.
4. As an operator, I want final completion to mean `typecheck + build + test` passed on the isolated rebuild target with no residual retry state.

## Non Goals

- Replace the ask/chat thread flow
- Remove planning support entirely from Shipyard
- Build a general-purpose project management system inside the dashboard
- Auto-generate PRDs or wireframes from prompts

## Success Metrics

### Primary

- Final isolated rebuild target passes `pnpm type-check`, `pnpm build`, and `pnpm test`
- Final run ends with no recoverable `executionIssue`
- Rebuild mode consumes fewer planning tokens because planner calls are skipped

### Secondary

- Fewer retries caused by planner drift
- Lower benchmark variance across repeated rebuild campaigns
- Better operator confidence because benchmark docs preserve best verified runs separately from latest attempts

## Functional Requirements

### 1. Execution plan input

Shipyard must accept a supplied execution plan from the API and dashboard.

Accepted forms:

- JSON plan payload with explicit `steps`
- Markdown plan converted to structured steps before execution
- Stored plan reference from a previous planning thread

Each step must contain:

- index
- description
- optional file list
- optional acceptance notes

### 2. Planner bypass

If a valid supplied plan is present, the graph must skip `planNode` and move directly into execution orchestration.

### 3. Orchestrator-first execution

The coordinator remains the default executor for planless runs.

Expected behavior:

- read supplied step list from state
- run one worker per step in sequence
- run deterministic verification after each worker step
- spawn repair worker for failing step when verification fails
- move to next step only after the current step is verified or terminally failed

### 4. Reference docs as runtime context

Rebuild PRD and wireframe documents must be attachable as contexts so worker agents can reference them during execution.

### 5. Benchmark truth separation

`docs/benchmarks.md` must separate:

- **Best Verified Runs**
- **Latest Attempts**
- **Rebuild Final Gates**

The default top table should prefer best verified evidence over recency.

### 6. Final completion gate

Rebuild completion must require the existing final gate in `scripts/run-rebuild.sh`, not just per-step run completion.

## Benchmark Truth Model

### Raw sources

- `results/*.json` — run results
- `results/snapshot-*.json` — benchmark and rebuild snapshots
- `results/events/*.json` — event/audit stream
- `docs/rebuild-run-2026-03-28.md` — rebuild campaign summary
- `docs/rebuild-run-audit.html` — audit bundle

### Rendering pipeline

- `src/reporting/benchmark-scope.ts`
- `src/reporting/benchmarks-report.ts`
- `scripts/render-benchmarks.ts`
- `docs/benchmarks.md`

### Required report behavior change

Benchmark reporting should rank by best verified outcome first.

Suggested preference order:

1. final gate passed
2. run status `done`
3. benchmark truth marked verified
4. zero new errors
5. lowest duration
6. lowest token total

Latest attempts should remain visible, but in a separate section.

## UX Requirements

### Rebuild setup

Operator can:

- choose target repo/worktree
- attach PRD
- attach wireframes
- attach or paste execution plan
- start planless rebuild run

### Run detail

Operator sees:

- supplied plan status per step
- active worker and repair attempts
- verification result after each step
- final gate status

## Risks

1. Supplied plans may be malformed or underspecified.
2. Removing planner-by-default could hurt generic ad hoc coding runs if the mode is not scoped correctly.
3. Benchmark ranking can become misleading if “verified” metadata is incomplete.

## Rollout

1. Add planless mode behind explicit API/dashboard flag.
2. Use it first for rebuild campaigns only.
3. Promote to default rebuild path after one full green isolated rebuild.

