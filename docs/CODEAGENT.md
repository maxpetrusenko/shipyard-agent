# CODEAGENT.md -- Shipyard Autonomous Coding Agent

> Architecture, strategy, and operational documentation for the Shipyard agent.

---

## 1. Agent Architecture

### Graph Topology

```
START -> plan -> execute -> verify -> review
                                       |-> continue -> execute (next step)
                                       |-> done -> report -> END
                                       |-> retry -> plan (with feedback)
                                       |-> escalate -> error_recovery
                                                        |-> plan (retry)
                                                        |-> report (fatal) -> END
```

### Node Specifications

| Node | Model | Purpose | Max Tool Rounds |
|------|-------|---------|----------------|
| `plan` | Opus 4.6 | Decompose instruction into steps, explore codebase | 15 |
| `execute` | Sonnet 4.6 | Execute current step via tool calls | 25 |
| `verify` | (bash) | Run `tsc --noEmit` + `vitest run`, parse errors | N/A |
| `review` | Opus 4.6 | Quality gate: continue / done / retry / escalate | 1 |
| `error_recovery` | (logic) | Decide retry vs abort based on retry count | N/A |
| `report` | Sonnet 4.6 | Summarize results for user | 1 |

### Model Routing

| Role | Model | Max Tokens | Temperature |
|------|-------|-----------|-------------|
| Planning | claude-opus-4-6 | 4096 | 0.3 |
| Coding | claude-sonnet-4-5-20250929 | 8192 | 0.2 |
| Review | claude-opus-4-6 | 2048 | 0.2 |
| Verification | claude-sonnet-4-5-20250929 | 2048 | 0.0 |
| Summary | claude-sonnet-4-5-20250929 | 2048 | 0.3 |

**Rationale**: Opus excels at complex reasoning (planning, review). Sonnet is 4x cheaper and faster for mechanical work (coding, verification). This split optimizes cost without sacrificing quality on critical decisions.

---

## 2. File Editing Strategy

### 4-Tier Cascading Fallback

The `edit_file` tool uses anchor-based string replacement with 4 tiers of matching:

**Tier 1: Exact Match**
- `old_string` appears exactly once in the file
- Direct replacement, highest confidence
- Rejects if 0 matches (falls to tier 2) or >1 matches (returns error with count)

**Tier 2: Whitespace-Normalized Match**
- Trim leading/trailing whitespace per line, collapse inner whitespace runs
- Handles indentation differences between LLM output and actual file
- Rejects if 0 or >1 normalized matches

**Tier 3: Fuzzy Match (Levenshtein)**
- Compute edit distance between candidate blocks and `old_string`
- Accept if distance < 10% of string length
- Picks best match if multiple candidates qualify
- Handles minor typos, renamed variables, small structural changes

**Tier 4: Full File Rewrite**
- Last resort: replaces entire file content with `new_string`
- Logged as "degraded edit" for audit
- Also used when file doesn't exist (creates new file with parent dirs)

### Step-by-Step Edit Flow

1. Agent reads file via `read_file(path)` (returns content with line numbers)
2. Agent identifies target block to change
3. Agent calls `edit_file(path, old_string, new_string)`
4. Server reads current file, runs 4-tier cascade
5. If match found: replace, write, return diff preview
6. Agent verifies via `bash("npx tsc --noEmit")`
7. If verification fails: agent reads error, calls `edit_file` again to fix

### Failure Modes

| Scenario | Behavior |
|----------|----------|
| No match found | Error + closest match suggestion -> agent retries with more context |
| Multiple exact matches | Error + match count -> agent provides more surrounding context |
| File changed between read/edit | Tier 4 rewrite on stale -> agent should re-read |
| Syntax error after edit | Verify node catches -> review node decides retry |
| 3 failed edit attempts | Error recovery -> retry with new plan or escalate |

---

## 3. Multi-Agent Design

### Supervisor Pattern

```
Supervisor (Opus)
  |-- decomposeTask(instruction)
  |     |-> SubTask[] + sequentialPairs[]
  |
  |-- runWorker(subtask) [parallel via Send()]
  |     |-> WorkerResult { fileEdits, tokenUsage, error }
  |
  |-- detectConflicts(results)
  |     |-> ConflictReport[] { filePath, workerIds, type }
  |
  |-- mergeEdits(results, conflicts)
        |-> merged edits + needsReplan conflicts
```

### Conflict Resolution Strategy

1. **Detection**: Compare file paths across worker outputs. Any overlap = potential conflict.
2. **Non-overlapping** (different regions of same file): Apply sequentially. Second worker re-reads after first's edits are applied.
3. **Overlapping** (same region): Supervisor re-plans the conflicting step with both workers' context merged.
4. **Structural** (type errors post-merge): Run typecheck after merge. Feed errors to the responsible worker.

### Worker Isolation

- Each worker gets a fresh graph invocation with its own context window
- Workers do NOT share state or tool call history
- Supervisor receives only: file edits, token usage, error (not full conversation)
- Max retries per worker: 2 (vs 3 for main graph)

---

## 4. Tools

| Tool | Description | Used By |
|------|-------------|---------|
| `read_file` | Read with line numbers | plan, execute |
| `edit_file` | 4-tier surgical edit | execute |
| `write_file` | Create/overwrite file | execute |
| `bash` | Shell command (30s/120s timeout) | execute, verify |
| `grep` | Ripgrep content search | plan, execute |
| `glob` | File pattern matching | plan, execute |
| `ls` | Directory listing | plan, execute |
| `spawn_agent` | Isolated sub-graph worker | execute (multi-agent) |
| `ask_user` | HITL interrupt | execute, review |
| `inject_context` | Add context mid-loop | execute |

---

## 5. Server & API

### Endpoints (port 4200)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/run` | Submit instruction |
| POST | `/api/inject` | Inject context mid-run |
| POST | `/api/cancel` | Cancel current run |
| GET | `/api/status` | Queue status |
| GET | `/api/runs` | List all runs |
| GET | `/api/runs/:id` | Get specific run |
| GET | `/api/health` | Health check |

### WebSocket (`/ws`)

Messages (client -> server):
- `{type: "submit", instruction: "..."}` -> starts a run
- `{type: "inject", context: {label, content}}` -> injects context
- `{type: "cancel"}` -> cancels current run
- `{type: "status"}` -> requests status

Messages (server -> client):
- `{type: "state_update", data: {...}}` -> real-time state changes
- `{type: "submitted", runId: "..."}` -> run accepted
- `{type: "status", data: {...}}` -> queue status

---

## 6. Database Schema

Three tables (migrations 050-052):

- `shipyard_runs` - Run history (instruction, status, phase, steps, file_edits, token_usage, trace_url)
- `shipyard_messages` - Conversation messages per run (role, content, tool info)
- `shipyard_contexts` - Persistent context entries (label, content, source, active flag)

---

## 7. Telemetry & Tracing

LangSmith integration via environment variables:
- `LANGCHAIN_TRACING_V2=true` enables automatic tracing of all LLM calls and tool invocations
- `LANGCHAIN_API_KEY` for authentication
- `LANGCHAIN_PROJECT=shipyard` for project organization

Every node transition, tool call, and LLM invocation is traced automatically via LangGraph's built-in LangSmith integration.

---

## 8. Package Structure

```
shipyard/
  src/
    index.ts                    # Server entry (port 4200)
    app.ts                      # Express app factory
    config/
      env.ts                    # Environment configuration
      model-policy.ts           # Opus/Sonnet routing
    graph/
      state.ts                  # ShipyardState Annotation
      builder.ts                # createShipyardGraph()
      edges.ts                  # Conditional routing
      nodes/
        plan.ts                 # Opus: decompose instruction
        execute.ts              # Sonnet: tool calls
        verify.ts               # tsc + test
        review.ts               # Opus: quality gate
        error-recovery.ts       # Retry or abort
        report.ts               # Summarize results
    tools/
      index.ts                  # Tool registry + dispatch
      edit-file.ts              # 4-tier surgical edit
      read-file.ts, write-file.ts, bash.ts, grep.ts, glob.ts, ls.ts
      spawn-agent.ts, ask-user.ts, inject-context.ts
    server/
      routes.ts                 # REST endpoints
      ws.ts                     # WebSocket handler
    runtime/
      loop.ts                   # Instruction queue + dispatch
      persistence.ts            # DB CRUD
      langsmith.ts              # Tracing helpers
    multi-agent/
      supervisor.ts             # Task decomposition
      worker.ts                 # Isolated sub-graph
      merge.ts                  # Conflict detection
    context/
      store.ts                  # Context registry
      injector.ts               # System prompt builder
  test/
    edit-file.test.ts           # 9 tests covering all 4 tiers + edge cases
```
