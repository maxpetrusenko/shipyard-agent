# AI Development Log

> One-page breakdown of AI-assisted development for the Shipyard autonomous coding agent.

---

## Tools & Workflow

**Primary tool**: Claude Code (CLI) running Claude Opus 4.6 for architecture/planning and Claude Sonnet 4.5 for implementation.

**Development workflow**: Every file in the project was authored through Claude Code sessions. Typical flow:
1. Describe the component/feature needed in natural language
2. Claude Code explores existing code, proposes implementation
3. Iterate on system prompts and tool schemas via conversation
4. Run `vitest` and `tsc --noEmit` in-session to validate

**Stack**: LangGraph (TypeScript) for the agent graph, Anthropic SDK for LLM calls, LangSmith for tracing, vitest for testing, Express + WebSocket for the server.

**Tracing**: LangSmith integration added from the first working graph. Every node transition, tool call, and LLM invocation is traced automatically. Public share links resolved post-run for shareable traces.

---

## Effective Prompts

### 1. PLAN_SYSTEM -- Instruction Decomposition (plan.ts)

```
You are Shipyard, an autonomous coding agent. You are in the PLANNING phase.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using tools, always use absolute paths (e.g. ${WORK_DIR}/src/index.ts).
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

Your job: decompose the user's instruction into concrete, executable steps.

For each step, specify:
- A clear description of what to do
- Which files need to be read or modified (use absolute paths)
- The order matters: dependencies first

You have tools to explore the codebase (read_file, grep, glob, ls, bash).
Use them to understand the codebase before making your plan.

After exploration, output your plan as a JSON array wrapped in <plan> tags:
<plan>
[
  {"index": 0, "description": "...", "files": ["${WORK_DIR}/path/to/file.ts"]},
  {"index": 1, "description": "...", "files": ["${WORK_DIR}/path/to/other.ts"]}
]
</plan>

Keep plans focused: 1-10 steps for most tasks. More than 10 steps means the task
should be decomposed into subtasks.
```

**Why it works**: Forces codebase exploration before planning (the agent reads files via tool calls before outputting a plan). The `<plan>` tag extraction gives structured output without forcing rigid JSON-only responses. Absolute path enforcement eliminates the most common class of tool call failures.

### 2. EXECUTE_SYSTEM -- Tool-Use Execution (execute.ts)

```
You are Shipyard, an autonomous coding agent. You are in the EXECUTION phase.

IMPORTANT: The target codebase is at: ${WORK_DIR}
All file paths must be absolute, rooted at ${WORK_DIR}.
When using tools, always use absolute paths (e.g. ${WORK_DIR}/src/index.ts).
When using bash, always cd to ${WORK_DIR} first or use absolute paths.

You are executing a specific step of a larger plan. Use the available tools to
implement the change.

Rules:
- Read files before editing (understand before modifying)
- Use edit_file for surgical changes (preferred over write_file)
- Use write_file only for new files
- Use bash for running commands (build, lint, format) -- always cd to ${WORK_DIR} first
- Make one logical change at a time
- When done with this step, say "STEP_COMPLETE" in your response
```

**Why it works**: The "read before edit" rule prevents blind edits. `STEP_COMPLETE` gives a clear termination signal the orchestrator can detect. Constraining to "one logical change at a time" prevents the agent from making sprawling edits that are hard to verify and roll back.

### 3. 4-Tier Edit Cascade (edit-file.ts tool schema)

The tool description exposed to the LLM:

```
edit_file: Make a surgical edit to a file. Provide the exact text to find
(old_string) and the replacement text (new_string). The old_string must be
unique in the file. If the exact match fails, the system will try
whitespace-normalized matching, then fuzzy matching. As a last resort, the
entire file will be rewritten with new_string.
```

The cascade implementation: Tier 1 (exact match) -> Tier 2 (whitespace-normalized, trim + collapse per line) -> Tier 3 (fuzzy, Levenshtein distance < 10% of string length) -> Tier 4 (full rewrite, logged as degraded).

**Why it works**: The LLM targets Tier 1 (exact match) because the schema tells it to be precise. Tiers 2-3 silently recover from common LLM failures (wrong indentation, minor character differences) without re-prompting. Tier 4 ensures the agent never gets stuck on a match failure. The tier number is returned in the result so the orchestrator can track edit quality.

### 4. Review Decision Prompt (review.ts)

```
You are the Shipyard quality reviewer (Opus). You evaluate the work done by the
coding agent.

You have full context: the original instruction, the plan, file edits made, and
verification results.

Your decision must be one of:
- "continue": More steps remain in the plan. Move to the next step.
- "done": All steps complete, verification passed, instruction fulfilled.
- "retry": Something is wrong. Provide specific feedback for the planner to fix.
- "escalate": The issue is ambiguous or beyond automated fixing. Ask the user.

Respond with a JSON object:
{"decision": "done|continue|retry|escalate", "feedback": "explanation if retry/escalate"}
```

**Why it works**: Four discrete decisions map cleanly to graph edges. The JSON output format is simple enough that parsing rarely fails. The "escalate" option gives the agent an exit hatch instead of looping forever. Review feedback flows back to the planner on retry, creating a feedback loop.

### 5. Context Injection Format

All injected context (specs, schemas, conventions, user messages) follows this pattern:

```
# Injected Context

## {label}
{content}

---

## {label}
{content}
```

Contexts are injected as markdown sections appended to system prompts. The label acts as a section header the LLM can reference. Priority levels (0 = always keep, 1 = keep if room, 2 = compactable) control what survives context compaction.

**Why it works**: Markdown headers give the LLM a table of contents for navigating large contexts. Plain text beats JSON wrapping for LLM comprehension. Deduplication by label prevents stale contexts from accumulating.

---

## Code Analysis

| Category | Estimate | Examples |
|----------|----------|---------|
| AI-generated | ~95% | Graph nodes, tool implementations, server routes, WebSocket handlers, test suites, state management, multi-agent scaffolding |
| Hand-written | ~5% | `.env` configuration, `bench.sh` script tuning (awk/grep parsing, variable sanitization), `setup-target.sh`, model policy constants, `tsconfig.json` |

The hand-written portions were almost entirely operational: environment setup, shell script debugging (parsing test output reliably in bash), and configuration values. All TypeScript application code was AI-generated.

---

## Strengths & Limitations

### Where AI Excelled

- **Boilerplate and scaffolding**: Express server, WebSocket handlers, route definitions, middleware, error handlers. Generated correctly on first attempt.
- **Tool schemas and validation**: Zod schemas, TypeScript interfaces, tool dispatch patterns. The LLM produced well-typed, consistent schemas.
- **System prompt engineering**: Iterating on prompts was fast. Claude Code could explain why a prompt phrasing would cause specific failure modes and propose alternatives.
- **Test suites**: Generated comprehensive test cases including edge cases (empty strings, multiple matches, file-not-found) that matched the implementation.
- **Architecture documentation**: PRESEARCH.md, CODEAGENT.md sections, mermaid diagrams, interface contracts. High-quality first drafts.

### Where AI Struggled

- **Shell script parsing**: The bench script (`bench.sh`) required multiple iterations to handle edge cases: multi-line grep output, empty variables breaking `jq --argjson`, and differences between GNU and BSD `date` flags.
- **Getting the agent to complete full tasks end-to-end**: The agent would sometimes stop after partial completion, or loop on verification failures without making meaningful progress. Required careful `STEP_COMPLETE` signaling and retry limit enforcement.
- **LangGraph API surface**: The TypeScript LangGraph SDK had some patterns (conditional edges, `Send()` for parallel dispatch) that required reading source code and examples rather than relying on the LLM's training data.
- **Environment-specific issues**: OAuth token retrieval from macOS Keychain, Doppler secret injection, and LangSmith environment variable naming (modern `LANGSMITH_*` vs legacy `LANGCHAIN_*`) all required manual debugging.

---

## Key Learnings

1. **Start with tracing early**. LangSmith tracing added from the first graph compilation exposed issues (wrong node routing, tool call failures, token budget overflows) that would have been invisible without trace visibility. Debugging agent behavior without tracing is guesswork.

2. **System prompt engineering is the highest-leverage activity**. Small changes to the PLAN_SYSTEM or EXECUTE_SYSTEM prompts (adding "read files before editing", enforcing absolute paths, requiring `STEP_COMPLETE`) had outsized impact on agent reliability. More effective than adding retry logic or fallback mechanisms.

3. **Anchor-based editing is proven reliable**. The 4-tier cascade (exact -> whitespace-normalized -> fuzzy -> full rewrite) handles the real failure modes of LLM-generated edits. Most edits hit Tier 1; Tier 2 catches indentation mismatches; Tier 3 handles minor character differences. Tier 4 (full rewrite) is the safety net. This matches what Claude Code, OpenCode, and Aider all converged on independently.

4. **Separate planning from execution**. Using Opus for planning/review and Sonnet for execution was the right split. Opus produces better plans and catches more issues in review. Sonnet is fast and cheap for mechanical tool use. Mixing both roles in one model led to worse outcomes than specialization.

5. **Shell scripts need human attention**. AI-generated bash was the least reliable output. Variable quoting, pipe parsing, cross-platform date commands, and `set -euo pipefail` interactions all required hand-tuning. For operational scripts, expect 2-3 rounds of manual debugging.

---

## Related

**Token and dollar totals** for the submission belong in **`docs/AI-COST.md`**: that file splits **Shipyard run usage** (Meter A) from **IDE / Claude Code development usage** (Meter B). This dev log is narrative only, not the cost ledger.
