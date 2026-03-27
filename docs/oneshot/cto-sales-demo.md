# Ship Agent — CTO Sales Demo (1-3 min)

> Audience: Engineers, technical leadership, Gauntlet cohort (recorded, async viewing)
> Format: Screen-recorded demo with voiceover. Conversational, builder energy.
> Tone: Builder sharing conviction. Confident, direct, every sentence earns its place.

---

## Opening Hook (15 sec)

> "If you've ever pointed an AI at your codebase, you know the pattern — it generates something that *technically compiles* but completely misses the architecture around it."
>
> "That's the gap I kept hitting. Every coding AI can *generate* code. Very few can **navigate an unfamiliar codebase, form a plan, execute surgically, and verify the result** — the way a senior engineer actually works. So I built one that does."

---

## The Problem (20 sec)

> "Existing tools fall into two camps:
>
> **Camp one**: Chat-based copilots. You paste code in, you get code back. You're still the orchestrator — managing file reads, running tests, validating output yourself.
>
> **Camp two**: Full autonomous agents — SWE-Agent, OpenHands, Devin. Powerful, and they ship as monolithic platforms. You clone their repo, run their infra, adopt their opinions. If you want to change how planning works or swap the model for execution, you're forking 50K lines of someone else's code.
>
> I wanted a third option: **start from zero, borrow the proven patterns, own every line.**"

---

## The Approach — Pattern Extraction Over SDK Adoption (40 sec)

> "I studied four production codebases and extracted the **specific architectural patterns** that make autonomous coding reliable — and wrote every line from scratch."

### Patterns Borrowed (say these, point to architecture slide/diagram)

| Pattern | Source Repo | What We Took |
|---------|------------|--------------|
| **Anchor-based file editing** with uniqueness validation | **OpenCode** (opencode-ai/opencode) | `edit(file, oldStr, newStr)` — content-anchored, immune to line-number drift. We extended it to a 4-tier cascade: exact match → whitespace-normalized → fuzzy (Levenshtein) → full rewrite |
| **Structured context compaction** | **OpenCode** | When context fills up, the system generates structured summaries (Goal, Instructions, Discoveries, Accomplished, Relevant Files) — task state survives every compaction cycle |
| **LangGraph StateGraph** with typed annotations | **Open SWE** (langchain-ai/open-swe) | Typed state management, automatic checkpointing, conditional edge routing — we wired our own graph using their proven pattern |
| **Three-phase REPL loop** (Gather → Act → Verify) | **Claude Code** (Anthropic) | Plan explores the codebase before outputting steps. Execute makes edits. Verify runs typecheck + tests deterministically — pure bash ground truth |
| **Subagent state isolation** | **Claude Code + Open SWE** | Workers get fresh context windows. Parent receives summaries only. Full context isolation between agents |
| **Safety-net middleware** | **Open SWE** | Deterministic verification runs *after* every execution — the agent must pass real tests, every time |
| **Copy-on-write file snapshots** | **Claude Code** | Checkpoint before every edit. Verification failure → rollback to pre-step state. Instant, complete recovery |
| **Multi-provider LLM routing** | **Gauntlet Software Factory** | Opus for planning/review (reasoning), Sonnet for execution (speed). Two models, each where they're strongest |

> "The insight: **the patterns are the product, the frameworks are just inspiration.** Every line of Ship Agent is ours. We understand it. We can change it."

---

## Tool Architecture (20 sec — reference, visual on screen)

> "The agent has 12 tools. Each has hard resource limits — timeouts, buffer caps, output ceilings. This is how you keep an autonomous agent predictable and safe."

| Tool | Purpose | Key Limits |
|------|---------|------------|
| `read_file` | Read with line numbers (cat -n) | Offset/limit paging |
| `edit_file` | 4-tier anchor edit cascade | Uniqueness validation per tier |
| `write_file` | Create/overwrite + auto mkdir | Copy-on-write snapshot |
| `bash` | Shell execution | 30s default / 120s max timeout, 100K char output cap, 10MB buffer, 43 blocked dangerous patterns |
| `grep` | Ripgrep-backed search | 50 result cap, 15s timeout, 5MB buffer |
| `glob` | File pattern matching | — |
| `ls` | Directory listing (skip dotfiles) | — |
| `spawn_agent` | Parallel subtask delegation | Inherits worker loop limits |
| `ask_user` | Clarifying questions via interrupt | LangGraph `interrupt()` |
| `revert_changes` | Undo edits via inverse ops or git restore | Trace-based rollback |
| `commit_and_open_pr` | Git commit + push + draft PR | 120s timeout, conditionally available |
| `inject_context` | Add context mid-run | Survives compaction |

### Token Budgets by Role

| Role | Max Tokens | Model | Temperature |
|------|-----------|-------|-------------|
| Planning | 16,384 | Opus 4.6 / GPT-5.4 | 0.3 |
| Coding (execution) | 8,192 | Sonnet 4.5 / GPT-5.4-mini | 0.2 |
| Review | 4,096 | Opus 4.6 / GPT-5.4 | 0.2 |
| Verification | 2,048 | Sonnet 4.5 / GPT-5.4-mini | 0.0 |
| Summary | 2,048 | GPT-5.4-mini | 0.3 |
| Intent classification | 16 | GPT-5.4-mini | 0.0 |

### Execution Guardrails

| Guardrail | Value |
|-----------|-------|
| Graph recursion limit | 150 steps (configurable 32-400) |
| Soft budget | 120 steps (dynamic: 16 + steps×6 + retries×4) |
| Max tool rounds per step | 25 |
| Max rounds before edit required | 8 (then nudge/stall) |
| Progress streak limit | 15 |
| Review-verify repeat cap | 10 |
| Message compaction threshold | 100,000 chars |
| Tool call history cap | 500 entries (oldest trimmed) |
| Retry counter | Resets after each successful step |
| Transient error recovery | Exponential backoff (500ms base, 30s max) |
| File persistence | Atomic writes (tmp + rename) |

---

## Live Demo (60-90 sec)

> "Let me show you the actual flow. I'm giving the agent a scoped refactoring task — one file, one change, full verification."

### The Prompt (show on screen)

```
In ship-refactored, refactor exactly one file: shipyard/src/tools/hooks.ts

Task:
- Remove the small duplication between `runBeforeHooks` and `runAfterHooks`
  by introducing one shared internal helper.
- Keep behavior identical.
- Edit only this file.

Hard constraints:
- If active repo differs from ship-refactored, stop and report mismatch.
- Preserve all existing exports and function signatures.
- Same files, same dependencies.

Validation:
- Run focused test(s) for hooks only.
- Report test command and result.
```

### What Happens (narrate as it runs)

> "Watch the five phases:
>
> 1. **Plan** — Opus reads the file, identifies the duplication, designs the internal helper. It explored the code first — it understands the structure before making any decisions.
> 2. **Execute** — Sonnet applies the edit using anchor-based replacement. The 4-tier cascade means even if whitespace is slightly off, the edit still lands cleanly.
> 3. **Verify** — Fully deterministic. Runs `pnpm vitest test/hooks.test.ts`. Bash output is ground truth — the system checks real test results, every time.
> 4. **Review** — Opus evaluates: behavior preserved? Exports intact? Constraints honored?
> 5. **Report** — Summary with diff, validation result, and what changed."

### Show the Trace

> "Every tool call, every LLM invocation, every state transition — traced to LangSmith. You can time-travel through the agent's reasoning. This is the observability story: **you verify the agent through its trace, the same way you'd review a pull request.**"

*(show LangSmith trace — tool calls, token usage, latency per step)*

### The Revert Demo

> "Now watch this — I revert the file changes. The agent's edits are tracked in the run trace. Ship Agent uses copy-on-write snapshots, so rollback is instant and complete. The codebase is back to its original state."

*(revert, show clean git status)*

> "And if I re-run? The changes land identically. Deterministic. Reproducible."

---

## Agent Reply Rendering — Streamdown

> "One more detail worth calling out. The agent's markdown output renders in real-time using **Streamdown** — Vercel's streaming markdown renderer. It handles partial blocks gracefully during generation. Clean rendering, stable layout. Tables, code blocks, math — all render as the tokens arrive."

---

## Closing (15 sec)

> "Three things to take away:
>
> 1. **We started from zero.** We studied four production codebases — OpenCode, Open SWE, Claude Code, Gauntlet Software Factory — and extracted the patterns that matter. Every line is ours.
> 2. **Every safeguard is deterministic.** Verification, rollback, guardrails — all enforced by the system, independent of the LLM.
> 3. **Full observability.** Every decision the agent makes is traced, auditable, and replayable.
>
> This is **autonomous software engineering with engineering-grade reliability.**"

---

## Vocabulary Bank (use naturally, weave in)

- **Anchor-based editing** — content-anchored replacement, immune to line-number drift
- **Structured compaction** — preserving task semantics when context window fills up
- **Deterministic verification** — bash ground truth, real test results every time
- **Copy-on-write snapshots** — instant, complete rollback at any point
- **State isolation** — subagents run in fresh context, parent stays clean
- **Soft budget** — agent self-regulates before hitting hard limits
- **Pattern extraction** — borrowing architecture, building from scratch
- **Four-tier cascade** — graceful progression from exact match to fuzzy to rewrite
- **Conditional edge routing** — graph-native decision logic (retry/escalate/done)
- **Observability-first** — every tool call traced to LangSmith, time-travel debugging

---

## Flow Diagram (draw or reference)

```
Prompt ──► Plan (Opus)
              │ explore codebase (grep, glob, read_file)
              │ output: numbered steps
              ▼
          Execute (Sonnet)
              │ tool calls: edit_file, bash, read_file
              │ 25 rounds max, 8-round edit watchdog
              ▼
          Verify (deterministic)
              │ typecheck → tests → pass/fail
              ▼
          Review (Opus)
              │ decision: done | retry (max 6) | escalate
              ▼
          Report
              │ diff summary, validation, what changed
              ▼
          LangSmith Trace (full observability)
```

---

## Submission Checklist

- [x] Live prompt → agent execution → result
- [x] Tool usage visible in trace
- [x] LangSmith trace with full observability
- [x] File revert → re-run demonstrates reproducibility
- [x] Architectural rationale (patterns over SDKs)
- [x] Token budgets and guardrails documented
- [x] Deterministic verification with real test output

**This covers the core requirements.** The trace demonstrates the full agent loop. The revert/re-run proves reproducibility. The pattern story differentiates from "I used framework X."
