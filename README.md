<h1 align="center">Shipyard Agent</h1>

<p align="center">
  <strong>Autonomous coding agent that plans, edits, verifies, and reviews code</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/LangGraph-1.2-purple.svg" alt="LangGraph">
  <img src="https://img.shields.io/badge/Claude-Opus_4.6-orange.svg" alt="Claude">
</p>

---

## What is Shipyard?

Shipyard is an autonomous coding agent built on LangGraph and the Anthropic SDK. It takes a natural language instruction, decomposes it into steps, makes surgical file edits, verifies correctness, and produces a structured report. It runs as a persistent server that accepts instructions over REST or WebSocket without restarting between tasks.

Built for the Gauntlet Shipyard sprint: build a coding agent from scratch, then use it to rebuild a real application.

---

## Architecture

```
User (CLI / WebSocket)
       |
   instruction + context
       |
  +----v----+     +--------------+
  | Server  |---->| Context Store|
  | Express |     | (specs, test |
  | + WS    |     |  results)    |
  +----+----+     +------+-------+
       |                 |
  +----v-----------------v-------+
  |       LangGraph StateGraph   |
  |                              |
  |  plan -> execute -> verify   |
  |    ^                  |      |
  |    |     review <-----+      |
  |    |       |                 |
  |    +--retry+   done->report  |
  |                              |
  |  Error: 3 retries -> escalate|
  +------------------------------+
       |
  LangSmith Trace
```

| Node | Model | Purpose |
|------|-------|---------|
| `plan` | Opus 4.6 | Decompose instruction, explore codebase |
| `execute` | Sonnet 4.5 | Make surgical edits via tool calls |
| `verify` | bash | Run `tsc --noEmit` + `vitest run` |
| `review` | Opus 4.6 | Quality gate: continue / done / retry / escalate |
| `report` | Sonnet 4.5 | Summarize results |

---

## File Editing Strategy

Anchor-based string replacement with a 4-tier cascading fallback:

| Tier | Strategy | When |
|------|----------|------|
| 1 | Exact match | `old_string` found verbatim |
| 2 | Whitespace-normalized | Trimmed leading/trailing per line |
| 3 | Fuzzy match | Levenshtein distance < 10% of string length |
| 4 | Full rewrite | Last resort, logged as degraded |

Every edit is verified (lint, type-check, tests) before moving on. Failed edits trigger re-read and retry with more context. After 3 failures, the step rolls back via FileOverlay snapshots.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/maxpetrusenko/shipyard-agent.git
cd shipyard-agent

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your keys:
#   ANTHROPIC_API_KEY   - Anthropic API key
#   LANGCHAIN_API_KEY   - LangSmith key (for tracing)
#   SHIPYARD_WORK_DIR   - path to the target codebase

# 4. Start the server
pnpm dev
```

The server starts on `http://localhost:4200`.

### Submit an instruction

```bash
curl -X POST http://localhost:4200/api/run \
  -H "Content-Type: application/json" \
  -d '{"instruction": "Add email validation to the login form"}'
```

### Run a benchmark

```bash
pnpm bench 01-strict-typescript
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/run` | Submit an instruction, returns `{ runId }` |
| POST | `/api/respond` | Resume after `ask_user` interrupt |
| GET | `/api/status` | Current run phase and step |
| GET | `/api/runs/:id` | Full state for a run |
| GET | `/api/health` | Server health check |

WebSocket available at `ws://localhost:4200` for real-time phase updates, tool call events, and `ask_user` prompts.

---

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file with line numbers, offset/limit support |
| `edit_file` | Surgical edit with 4-tier cascade |
| `write_file` | Create new files |
| `bash` | Execute shell commands (sandboxed, 120s timeout) |
| `grep` | Ripgrep-backed content search |
| `glob` | File pattern matching |
| `ls` | Directory listing with types and sizes |
| `inject_context` | Add runtime context (specs, schemas) |
| `ask_user` | Pause loop for human input |
| `spawn_agent` | Delegate subtask to isolated worker |

---

## Project Structure

```
shipyard-agent/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Express app setup
│   ├── config/
│   │   ├── env.ts            # Environment config
│   │   └── model-policy.ts   # Model routing (Opus/Sonnet)
│   ├── context/
│   │   ├── injector.ts       # Context injection middleware
│   │   └── store.ts          # Context storage with priority
│   ├── graph/
│   │   ├── builder.ts        # LangGraph StateGraph wiring
│   │   ├── edges.ts          # Conditional edge routing
│   │   ├── state.ts          # ShipyardState annotation
│   │   └── nodes/
│   │       ├── plan.ts       # Planning node (Opus)
│   │       ├── execute.ts    # Execution node (Sonnet)
│   │       ├── verify.ts     # Verification node (bash)
│   │       ├── review.ts     # Review node (Opus)
│   │       ├── report.ts     # Report generation
│   │       └── error-recovery.ts
│   ├── multi-agent/
│   │   ├── supervisor.ts     # Task decomposition + dispatch
│   │   ├── worker.ts         # Isolated worker execution
│   │   └── merge.ts          # Output merging + conflict detection
│   ├── runtime/
│   │   ├── loop.ts           # Persistent instruction loop
│   │   ├── persistence.ts    # State save/restore
│   │   └── langsmith.ts      # Tracing integration
│   ├── server/
│   │   ├── routes.ts         # REST API
│   │   └── ws.ts             # WebSocket handler
│   └── tools/
│       ├── index.ts          # Tool registry + dispatch
│       ├── edit-file.ts      # 4-tier cascade editor
│       ├── file-overlay.ts   # Copy-on-write snapshots
│       ├── hooks.ts          # Pre/post tool hooks
│       └── ...               # Individual tool implementations
├── scripts/
│   └── bench.sh              # Benchmark harness
├── instructions/             # Benchmark instruction files
├── docs/
│   ├── PRESEARCH.md          # Architecture research
│   ├── CODEAGENT.md          # Agent documentation
│   └── requirements.md       # Project requirements
└── package.json
```

---

## Observability

Every run produces a LangSmith trace with:
- LLM calls (input, output, tokens, latency)
- Tool calls (name, args, result, duration)
- Node transitions with state snapshots
- Error classification and recovery actions

Set `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` in `.env` to enable.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Agent Framework | LangGraph (TypeScript) |
| LLM | Claude Opus 4.6 / Sonnet 4.5 (Anthropic SDK) |
| Observability | LangSmith |
| Server | Express + WebSocket |
| Validation | Zod |
| Testing | Vitest |

---

## Common Commands

```bash
pnpm dev          # Start server (watch mode)
pnpm build        # Compile TypeScript
pnpm start        # Run compiled output
pnpm type-check   # Type-check without emitting
pnpm test         # Run tests
pnpm bench <name> # Run benchmark instruction
```

---

## Documentation

- [PRESEARCH.md](./docs/PRESEARCH.md) — Open source research, architecture decisions, file editing strategy
- [CODEAGENT.md](./docs/CODEAGENT.md) — Agent architecture, trace links, rebuild log
- [Requirements](./docs/requirements.md) — Project requirements and checklist

---

## License

[MIT License](./LICENSE)
