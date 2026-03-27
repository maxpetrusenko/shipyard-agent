# Long-Running Agent Prompt Guide

Guidelines for writing prompts that keep the agent running in a single session for large tasks.

## Why Tasks Fragment Into Multiple Threads

1. **Vague scope** — agent can't determine when it's "done"
2. **No priority ordering** — agent attempts everything at once, hits budget
3. **Missing verification criteria** — agent loops on review/verify without convergence
4. **File conflicts in parallel agents** — multiple workers write to same file
5. **No error recovery context** — transient failures kill the run

## Prompt Template: Large Refactoring

```
Target repo: <absolute path>
Working directory: <absolute path>

## Task
<1-2 sentence high-level goal>

## Scope (ordered by priority)
1. <most critical change — must complete>
2. <second priority — complete if time allows>
3. <third priority — skip if budget is tight>

## Hard Constraints
- Edit only files under <path>
- Do NOT modify <protected files>
- Preserve all existing exports and public APIs
- If a test fails that was already failing before, ignore it (pre-existing)

## Verification
- Run: <exact test command>
- Pass criteria: <what "green" looks like>
- Known pre-existing failures: <list or "none">

## Recovery Instructions
- On rate limit: wait and retry (exponential backoff is automatic)
- On test failure: fix the root cause, don't skip the test
- On scope creep: stop, report what's done, list what's remaining
- On file conflict: serialize the conflicting edits, don't parallelize

## Completion Signal
Report: files changed, tests passed/failed, remaining work (if any)
```

## Anti-Patterns to Avoid

### Bad: Unbounded scope
```
Fix every issue in the codebase.
```

### Good: Scoped + prioritized
```
Fix these 5 issues in priority order. Stop after each fix, verify, then continue.
If budget runs low, report progress and list remaining items.
```

### Bad: No verification
```
Refactor the auth module to use JWT.
```

### Good: Testable outcome
```
Refactor the auth module to use JWT.
Verification: `pnpm vitest run src/auth.test.ts` must pass.
Known pre-existing: `github-thread-continuity.test.ts` already fails (ignore).
```

### Bad: Parallel writes to shared files
```
Refactor all 10 route files in parallel.
```

### Good: Module-first, integrate last
```
Phase 1 (parallel): Create standalone module files for each route.
Phase 2 (serial): Update routes.ts to import all modules in a single pass.
```

## Guardrail Reference (current values)

| Guardrail | Value | Impact |
|-----------|-------|--------|
| Recursion limit | 150 (max 400) | Set via `SHIPYARD_GRAPH_RECURSION_LIMIT` |
| Soft budget | Dynamic: 16 + steps*6 + retries*4 | Override: `SHIPYARD_GRAPH_SOFT_BUDGET` |
| Max tool rounds/step | 25 | Agent stalls if no edit after 8 rounds |
| Retry counter | Resets per step | Long plans get full retry budget per step |
| Backoff | 500ms * 2^attempt (max 30s) | Automatic for rate limits/timeouts |
| History cap | 500 tool calls | Oldest entries trimmed |

## For Ship Rebuild (oneshot pattern)

```
Target: /Users/maxpetrusenko/Desktop/Gauntlet/ship-rebuild-rerun-20260327c
Step instruction file: instructions/<step-number>.md

## Execution
1. Read the instruction file
2. Execute each task in order
3. After each task: run `pnpm -r run type-check` and relevant tests
4. If type-check fails on a file you didn't touch, skip it (pre-existing)
5. If a task is blocked, report blocker and move to next task

## Coordination
- Each instruction file targets specific files — do NOT touch files outside scope
- If multiple instruction files share a file, execute them serially
- Commit after each completed instruction step

## On Failure
- Report: which task, which file, what error
- Do NOT create a new thread — stay in this session
- Retry with a different approach before giving up
```
