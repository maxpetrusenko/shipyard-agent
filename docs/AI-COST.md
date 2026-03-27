# AI Cost Ledger

> Last updated: 2026-03-27. Satisfies **AI Cost Analysis** with **two separate meters**. Reviewers need to see **product/runtime agent spend** apart from **tooling used to build ship-agent**.

---

## 1. Meter A: Shipyard Agent Runs (Production-Shaped)

**What this is:** LLM usage for **`POST /api/run`** executions only. Each run accumulates `tokenUsage` (input/output) across plan, execute, review, report, etc. The server stores runs; bench writes `results/<benchId>.json`. The agent supports both OpenAI and Anthropic model families.

**Where the numbers live**

| Source | Fields |
|--------|--------|
| API | `GET /api/runs`, `GET /api/runs/:id` → `tokenUsage`, run duration, phase |
| Bench artifacts | `results/*.json` → `tokenUsage`, `estimatedCost` (blended estimate in bench output) |
| LangSmith | Public trace links; usage details per trace |
| Dashboard | Server-rendered at `/`, live WebSocket updates |

**Current model pricing (from `src/config/model-policy.ts`)**

| Model | Role (default) | Input ($/1M tokens) | Output ($/1M tokens) |
|-------|---------------|---------------------|----------------------|
| GPT-5.4 | Planning, Review | $2.50 | $10.00 |
| GPT-5.4-mini | Coding, Verification, Chat | $0.25 | $2.00 |
| GPT-5.4-nano | (available) | $0.10 | $0.40 |
| Claude Opus 4.6 | Planning, Review (Anthropic family) | $15.00 | $75.00 |
| Claude Sonnet 4.5 | Coding, Verification (Anthropic family) | $3.00 | $15.00 |
| Claude Haiku 4.5 | Intent, light tasks (Anthropic family) | $1.00 | $5.00 |

**Per-run token consumption (estimated from run structure)**

| Task type | Input tokens (est.) | Output tokens (est.) | Est. cost (OpenAI default) | Est. cost (Anthropic family) |
|-----------|--------------------|--------------------|---------------------------|------------------------------|
| Single-file edit | 15K-30K | 5K-10K | $0.01-0.03 | $0.05-0.15 |
| Multi-file feature | 50K-150K | 20K-50K | $0.05-0.20 | $0.30-1.50 |
| Codebase-wide change | 200K-500K | 50K-150K | $0.15-0.75 | $1.00-5.00 |

### Meter A Summary

| Item | Amount | Notes |
|------|--------|-------|
| Shipyard runs counted | 50+ | Development + bench runs (Claude Max plan) |
| Rebuild pipeline status | Step 03 done, Step 04 retrying, 05-09 queued | Running against ship-refactored clone |
| Estimated $ (dev runs, Max plan) | $0 incremental | Flat-rate subscription covers all usage |
| Estimated $ (if standard API, OpenAI) | ~$5-15 total | Estimated across all dev runs |
| Estimated $ (if standard API, Anthropic) | ~$30-80 total | Estimated across all dev runs |

**Assumptions for projections (100 / 1K / 10K users)**

Using OpenAI default routing (GPT-5.4 + GPT-5.4-mini):

| Scale | Invocations/user/day | Tokens/invocation (in/out) | Cost/invocation | Monthly cost |
|-------|---------------------|---------------------------|-----------------|--------------|
| 100 users | 3 | 80K / 30K | ~$0.08 | ~$720 |
| 1K users | 3 | 80K / 30K | ~$0.08 | ~$7,200 |
| 10K users | 3 | 80K / 30K | ~$0.08 | ~$72,000 |

With Anthropic family (Opus + Sonnet), multiply by ~5-8x.

---

## 2. Meter B: Development and Testing AI (Claude Code, etc.)

**What this is:** Tokens and spend from **Claude Code**, **Codex**, and any **human-in-the-loop** sessions used to author ship-agent, docs, and scripts. This is **not** the same as Meter A.

**Where the numbers live**

| Source | Notes |
|--------|--------|
| Claude Code (Max plan) | Primary development tool; flat-rate, no per-token billing |
| Anthropic Console | API usage for any direct SDK calls during testing |
| Manual log | Date, tool, rough tokens or $ if export unavailable |

### Meter B Summary

| Period | Tool | Notes | Input tokens (est.) | Output tokens (est.) | $ (est.) |
|--------|------|-------|---------------------|----------------------|----------|
| 2026-03-01 to 2026-03-27 | Claude Code (Max plan) | Primary dev tool: architecture, implementation, tests, docs | ~5M-10M | ~2M-5M | $0 (flat-rate) |
| 2026-03-01 to 2026-03-27 | LangSmith tracing | Trace inspection, debug | N/A | N/A | Free tier |

**Total development spend (Meter B only):** $0 incremental (Claude Max plan, flat-rate subscription). All development sessions across the full project were covered by the subscription.

**Total agent-run spend (Meter A only):** $0 incremental (same Max plan). Estimated equivalent at standard API pricing: $5-15 (OpenAI), $30-80 (Anthropic).

---

## 3. Cost Model Design

The agent's cost model is defined in `src/config/model-policy.ts`:

- **Tiered routing**: High-reasoning models (GPT-5.4 / Opus) for planning and review; fast models (GPT-5.4-mini / Sonnet) for execution and verification. This reduces cost by 60-80% compared to using the expensive model for all phases.
- **Fast-path review**: Intermediate review steps skip the expensive model when verification passes and steps remain, invoking the full review model only on the final step.
- **Provider flexibility**: `modelFamily` parameter switches between OpenAI and Anthropic defaults. Per-stage overrides allow mixing providers (e.g., Opus for planning, GPT-5.4-mini for execution).
- **Cache pricing**: Anthropic cache reads (90% discount) and writes (25% premium) are reflected in `estimateCost()`.
- **Rate-limit fallback**: `getRateLimitFallbackModel()` escalates to a more expensive model within the same provider on 429 errors, trading cost for availability.

---

## 4. Requirements Crosswalk

| `requirements.md` asks for | Use |
|----------------------------|-----|
| Claude API costs (input/output) for **development** | Meter **B** (Claude Max plan, flat-rate, $0 incremental) |
| Number of agent invocations during development | 50+ Meter **A** runs + hundreds of Claude Code sessions (Meter **B**) |
| Total development spend | $0 incremental (flat-rate plan); ~$35-95 equivalent at standard API pricing |
| Production projections (100 / 1K / 10K users) | Derive from **Meter A** per-invocation estimates above; OpenAI default ~$0.08/run, Anthropic ~$0.50/run |

---

## 5. Honest Assessment

- **All development costs were absorbed by Claude Max plan** (flat-rate). This means we have token estimates but no actual per-token billing data from the development phase.
- **Rebuild pipeline is in progress** (Step 03 done, Step 04 retrying, Steps 05-09 queued). Final Meter A numbers will increase as the pipeline completes.
- **Production cost projections are estimates** based on observed run structure and published API pricing. Actual costs depend on instruction complexity, codebase size, and retry rates.
- **The OpenAI-first default is 5-8x cheaper** than Anthropic family for equivalent tasks, which is why it was chosen as the default routing. Quality comparison between providers is task-dependent and not yet formally benchmarked.

---

## Related

- `docs/AI-DEV-LOG.md` -- workflow narrative (complements Meter B context).
- `docs/CODEAGENT.md` -- how `estimatedCost` is computed inside a single run.
- `docs/COMPARATIVE.md` -- trade-off analysis including Section 6.1 on model routing decisions.
- `src/config/model-policy.ts` -- per-model USD rates, family defaults, resolution logic.
