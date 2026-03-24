# AI cost ledger

> Satisfies **AI Cost Analysis** in `docs/requirements.md` with **two separate meters**. Do not merge them: reviewers need to see **product/runtime agent spend** apart from **tooling used to build ship-agent**.

---

## 1. Meter A: Shipyard agent runs (production-shaped)

**What this is:** Anthropic usage for **`POST /api/run`** executions only. Each run accumulates `tokenUsage` (input/output) across plan, execute, review, report, etc. The server stores runs; bench writes `results/<benchId>.json`.

**Where the numbers live**

| Source | Fields |
|--------|--------|
| API | `GET /api/runs`, `GET /api/runs/:id` → `tokenUsage`, run duration, phase |
| Bench artifacts | `results/*.json` → `tokenUsage`, `estimatedCost` (blended estimate in bench output) |
| LangSmith | Public trace links; usage details per trace |

**How to roll up Meter A (local)**

```bash
./scripts/aggregate-shipyard-results.sh
```

Fill the **production-style** table for the assignment from Meter A totals plus your assumptions (invocations per user per day, etc.).

### Meter A summary (edit as runs complete)

| Item | Amount |
|------|--------|
| Shipyard runs counted | |
| Total input tokens (agent) | |
| Total output tokens (agent) | |
| Estimated $ (use `model-policy` rates or bench blend) | |

**Assumptions for projections (100 / 1K / 10K users)**

- Average Shipyard invocations per user per day:
- Average tokens per invocation (input / output) from Meter A:
- Cost per invocation:

---

## 2. Meter B: Development and testing AI (Cursor, Claude Code, etc.)

**What this is:** Tokens and spend from **IDE assistants**, **Claude Code**, **Codex**, **chat exports**, and any **human-in-the-loop** sessions used to author ship-agent, docs, and scripts. This is **not** the same as Meter A unless you literally only develop by submitting work through your own `/api/run` (unusual).

**Where the numbers live**

| Source | Notes |
|--------|--------|
| Cursor | Usage / billing UI or account export |
| Claude Code / Anthropic Console | API or Max plan usage **excluding** what you already counted in Meter A |
| Manual log | Date, tool, rough tokens or $ if export unavailable |

### Meter B summary (edit from your vendor dashboards)

| Period | Tool | Notes | Input tokens (est.) | Output tokens (est.) | $ (est.) |
|--------|------|-------|---------------------|----------------------|----------|
| | | | | | |

**Total development spend (Meter B only):** $___

**Total agent-run spend (Meter A only):** $___

---

## 3. Requirements crosswalk

| `requirements.md` asks for | Use |
|----------------------------|-----|
| Claude API costs (input/output) for **development** | Meter **B** (+ Meter **A** only for dev runs you drove through Shipyard) |
| Number of agent invocations during development | Meter **B** session counts; optionally plus Meter **A** bench/rebuild run count |
| Total development spend | Sum of **B**; call out **A** separately if both apply |
| Production projections (100 / 1K / 10K users) | Derive from **Meter A** shape (tokens per real agent invocation), not from Cursor usage |

---

## Related

- `docs/AI-DEV-LOG.md` — workflow narrative (complements Meter B context, not a substitute for numbers).
- `docs/CODEAGENT.md` — § Cost Tracking: how `estimatedCost` is computed inside a single run.
- `src/config/model-policy.ts` — per-model USD rates for estimates.
