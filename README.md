# Shipyard -- Autonomous Coding Agent

Autonomous coding agent that takes a natural language instruction, decomposes it into steps, makes surgical file edits, verifies correctness via typecheck and tests, and self-corrects through a review loop. Built on LangGraph + Anthropic Claude.

## Architecture

Shipyard runs as a stateful LangGraph `StateGraph` with conditional edges:

```
START -> plan -> execute -> verify -> review
                                       |-> continue -> execute (next step)
                                       |-> done -> report -> END
                                       |-> retry -> plan (with feedback)
                                       |-> escalate -> error_recovery
                                                        |-> plan (retry)
                                                        |-> report (fatal) -> END
```

| Node | Model | Purpose |
|------|-------|---------|
| `plan` | Opus 4.6 | Decompose instruction into steps, explore codebase |
| `execute` | Sonnet 4.5 | Execute current step via tool calls (25 rounds max) |
| `verify` | bash | Run `tsc --noEmit` + `vitest run`, parse errors |
| `review` | Opus 4.6 | Quality gate: continue / done / retry / escalate |
| `error_recovery` | logic | Decide retry (with file rollback) vs abort |
| `report` | Sonnet 4.5 | Summarize results and cost |

Tools: `read_file`, `edit_file` (4-tier surgical edit with fuzzy fallback), `write_file`, `bash`, `grep`, `glob`, `ls`, `spawn_agent`, `ask_user`, `inject_context`.

File edits use anchor-based string replacement: exact match, whitespace-normalized, Levenshtein fuzzy (< 10% distance), full rewrite as last resort.

## Prerequisites

- **Node.js** >= 20
- **pnpm** (any recent version; `npm install -g pnpm`)

## Quick Start

```bash
git clone <repo-url> ship-agent
cd ship-agent
pnpm install
cp .env.example .env
# Edit .env -- at minimum set ANTHROPIC_API_KEY (or log in via Claude Code for OAuth)
pnpm dev
```

Server starts on `http://localhost:4200`. Verify:

```bash
curl http://localhost:4200/api/health
# {"status":"ok"}
```

For production:

```bash
pnpm build
pnpm start
```

## Configuration

All env vars are documented in `.env.example`. Copy it and fill in your values.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | -- | Anthropic API key (`sk-ant-...`). *Not needed if using `ANTHROPIC_AUTH_TOKEN` or Claude Code Keychain auth. |
| `ANTHROPIC_AUTH_TOKEN` | No | -- | OAuth token (alternative to API key) |
| `ANTHROPIC_BASE_URL` | No | Anthropic default | Custom API base URL (e.g., local proxy for Claude Max) |
| `SHIPYARD_PORT` | No | `4200` | HTTP + WebSocket server port |
| `SHIPYARD_WORK_DIR` | No | `cwd()` | Working directory the agent operates in (the target repo) |
| `SHIPYARD_API_KEY` | No | -- | Bearer token for API authentication. When set, all endpoints except `/api/health` require `Authorization: Bearer <key>`. |
| `SHIPYARD_DB_URL` | No | -- | PostgreSQL connection string for persistent run storage. Falls back to in-memory. |
| `LANGCHAIN_TRACING_V2` | No | `false` | Set `true` to enable LangSmith tracing |
| `LANGCHAIN_API_KEY` | No | -- | LangSmith API key (also accepts `LANGSMITH_API_KEY`) |
| `LANGCHAIN_PROJECT` | No | `shipyard` | LangSmith project name (also accepts `LANGSMITH_PROJECT`) |

## API

### `GET /api/health`

```bash
curl http://localhost:4200/api/health
```

### `POST /api/run`

Submit an instruction. Returns `{ runId }`.

```bash
curl -X POST http://localhost:4200/api/run \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Add strict TypeScript to all files"}'
```

With context injection:

```bash
curl -X POST http://localhost:4200/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "Refactor auth module",
    "contexts": [{"label": "CLAUDE.md", "content": "...", "source": "system"}]
  }'
```

### `GET /api/runs/:id`

Get full state for a specific run.

```bash
curl http://localhost:4200/api/runs/<run-id>
```

### `GET /api/runs`

List runs with pagination.

```bash
curl "http://localhost:4200/api/runs?limit=10&offset=0"
```

### `POST /api/inject`

Inject context into a running agent (max 500KB).

```bash
curl -X POST http://localhost:4200/api/inject \
  -H "Content-Type: application/json" \
  -d '{"label": "extra-context", "content": "Use zod for all validation"}'
```

### `POST /api/cancel`

Cancel the current run.

```bash
curl -X POST http://localhost:4200/api/cancel
```

### WebSocket (`ws://localhost:4200/ws`)

```jsonc
// Client -> Server
{"type": "submit", "instruction": "..."}
{"type": "inject", "context": {"label": "...", "content": "..."}}
{"type": "cancel"}
{"type": "status"}

// Server -> Client
{"type": "submitted", "runId": "..."}
{"type": "state_update", "data": {...}}
{"type": "status", "data": {...}}
```

30-second heartbeat (ping/pong). Unresponsive clients are terminated.

### Authentication

When `SHIPYARD_API_KEY` is set, all `/api/*` endpoints (except `/api/health`) require:

```
Authorization: Bearer <your-key>
```

### Rate Limiting

- `POST /api/run`: 10 requests/minute per IP
- All other endpoints: 60 requests/minute per IP

## Benchmarks

Place instruction markdown files in `instructions/` (e.g., `instructions/01-strict-typescript.md`), then:

```bash
./scripts/bench.sh 01-strict-typescript
```

The harness resets the target repo, captures baseline metrics, starts the server, submits the instruction, polls until completion, runs post-verification (typecheck + tests), and writes a JSON result to `results/`.

Set `SHIPYARD_TARGET` to override the default target repo path.

## Tests

```bash
pnpm test
# or: npx vitest run
```

226 tests across 18 files. Covers: 4-tier edit cascade, bash safety (dangerous command blocking), LangSmith tracing, REST routes, WebSocket, context store, multi-agent coordination, graph state annotations, and tool registry.

Watch mode:

```bash
pnpm test:watch
```

## Project Structure

```
src/
  index.ts                       # Server entry point (port 4200)
  app.ts                         # Express app, auth middleware, rate limiter
  config/
    env.ts                       # Environment configuration
    client.ts                    # Anthropic SDK client (API key or OAuth via Keychain)
    model-policy.ts              # Opus/Sonnet routing + cost estimation
  graph/
    state.ts                     # ShipyardState Annotation
    builder.ts                   # createShipyardGraph()
    edges.ts                     # Conditional routing logic
    nodes/
      plan.ts                    # Opus: decompose instruction into steps
      execute.ts                 # Sonnet: tool calls + file overlay snapshots
      verify.ts                  # tsc --noEmit + vitest run
      review.ts                  # Opus: quality gate (continue/done/retry/escalate)
      error-recovery.ts          # Retry with file rollback, or abort
      report.ts                  # Summarize results + estimated cost
      coordinate.ts              # Multi-agent coordination node
  tools/
    index.ts                     # Tool registry + dispatch
    edit-file.ts                 # 4-tier surgical edit
    hooks.ts                     # Tool call hooks (cost accumulation)
    read-file.ts, write-file.ts, bash.ts, grep.ts, glob.ts, ls.ts
    spawn-agent.ts, ask-user.ts, inject-context.ts
  server/
    routes.ts                    # REST endpoints (CRUD, pagination, validation)
    ws.ts                        # WebSocket handler + heartbeat
  runtime/
    loop.ts                      # Instruction queue + dispatch + trace resolution
    persistence.ts               # DB CRUD (Postgres or in-memory)
    langsmith.ts                 # Tracing + public share links
  multi-agent/
    supervisor.ts                # Task decomposition + worker dispatch
    worker.ts                    # Isolated sub-graph worker
    merge.ts                     # Conflict detection + edit merging
  context/
    store.ts                     # Context registry
    injector.ts                  # System prompt builder
scripts/
  bench.sh                       # Benchmark harness
  migrations/
    001-init.sql                 # DDL: shipyard_runs, shipyard_messages, shipyard_contexts
test/                            # 18 test files, 226 tests
```
