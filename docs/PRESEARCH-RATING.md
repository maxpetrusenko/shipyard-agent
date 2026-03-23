# Presearch Quality Rating

> Rated 1-10 per item on two axes: **Research Depth** and **Agent-Readiness** (designed for coding agents to consume, not humans).
> Date: 2026-03-23

---

## FleetGraph Presearch (10 items)

| # | Topic | Research | Agent-Ready | Notes |
|---|-------|----------|-------------|-------|
| 01 | Complete Presearch Before Code | **4/10** | **3/10** | Process principle, not research. No schemas, no acceptance criteria, no test vectors. A human could wing it from this; an agent would stall on ambiguity. |
| 02 | Proactive and On-Demand Modes | **7/10** | **6/10** | Solid architecture decision w/ rationale. Deep dive adds 15 use cases. Missing: explicit input/output contracts per mode that an agent could directly wire. State shape is described but not typed. |
| 03 | Context-Aware Embedded Chat | **5/10** | **4/10** | Correct decision captured. But the "what to fetch per page" table is prose, not a typed dispatch map. No component wireframe, no API request/response shapes. An agent building this would need to infer too much. |
| 04 | LangGraph and LangSmith | **9/10** | **9/10** | Best doc in the set. Version matrix, copy-paste code, package install commands, 9-section deep dive with graph wiring, interrupt/resume, parallel patterns, file structure. An agent could implement directly from this. |
| 05 | Required Node Types | **6/10** | **5/10** | Good taxonomy (context/fetch/reasoning/action/HITL/error). But the README delegates all detail to Phase 2 deep dives. No node signatures, no input/output types inline. Agent would need to chase 3 other docs. |
| 06 | Ship REST API Data Source | **7/10** | **7/10** | API surface table is concrete and agent-parseable. Endpoint list, use-per-node mapping, boundary constraints. Loses points for not including response schemas or example payloads. |
| 07 | Human Approval Before Consequential Actions | **7/10** | **5/10** | Policy is clear (allowed vs gated table). But the actual approval UX, persistence schema, and resume flow are spread across Phase 2 docs. No approval state machine diagram that an agent could implement. |
| 08 | Real Data and Public Deployment | **4/10** | **3/10** | Thin. "Run against real data, no mocks" is a principle, not research. No deployment script, no env var checklist, no health-check contract. Agent gets almost nothing actionable. |
| 09 | Detection Latency Under 5 Minutes | **8/10** | **7/10** | Strong reasoning (why 4min not 5min, hybrid model, dedup). Threshold table is concrete. Missing: a pseudocode sweep loop or scheduler interface an agent could translate to code. |
| 10 | Cost Analysis | **9/10** | **8/10** | Exceptional. Per-call cost math, 3-tier volume projections, 5 cost cliffs with multipliers, sensitivity table, mitigation tiers. Loses 1pt on agent-readiness because the logging schema is a sketch, not a migration-ready DDL. |

**FleetGraph average: Research 6.6, Agent-Ready 5.7**

---

## ShipYard Presearch (Coding Agent)

| # | Topic | Research | Agent-Ready | Notes |
|---|-------|----------|-------------|-------|
| 1 | OpenCode deep dive | **8/10** | **8/10** | Source files cited, patterns extracted (anchor edit, compaction, tool.define). "What I'd take / do differently" is perfect agent-consumable format. |
| 2 | Open SWE / LangChain | **7/10** | **7/10** | 4-agent architecture mapped, middleware pattern extracted. Blog/DeepWiki sourced. Slightly weaker because no code was read directly (repo was renamed). |
| 3 | Claude Code | **8/10** | **8/10** | Official docs + Pragmatic Engineer deep dive. str_replace pattern, subagent isolation, permission model all extracted. Directly implementable. |
| 4 | Software Factory audit | **9/10** | **9/10** | Our own code. File-by-file reuse map with YES/PARTIAL/NO. Gaps identified (no surgical edits, no persistent loop, no tracing). This is exactly what an agent needs. |
| 5 | File Editing Strategy | **9.5/10** | **9.5/10** | Chosen strategy justified. 4-tier cascade defined with typed return schema. Hashline counter-evidence (Anthropic NOT_PLANNED, DEV.to penalty, training bias). Error classification (transient/deterministic/fatal). Test vectors for every failure mode. Fast Apply noted as future tier-4 optimization. |
| 6 | System Diagram | **9/10** | **9.5/10** | ASCII diagram + full TypeScript node signatures (`ShipyardState` interface, `NodeFn` type). Edge routing spelled out as conditional logic. Agent can implement graph wiring directly from contracts. |
| 7 | Multi-Agent Design | **9/10** | **9/10** | Typed `Subtask`, `WorkerResult`, `ConflictReport` interfaces. `Send()` code skeleton for parallel dispatch. Conflict resolution state machine (4 scenarios). Git worktree alternative acknowledged. MVP sequential decision with forward-compatible contracts. |
| 8 | Context Injection | **9/10** | **9.5/10** | `ContextBlock` type with priority levels. Actual system prompt template (Handlebars-style). Compaction mechanism specified (structured summary, OpenCode pattern). Dedup-by-label. Test vectors for injection + compaction. |
| 8b | Provider Abstraction | **9/10** | **9/10** | Coupling audit with file:line references. `LLMProvider` interface typed. 4 portability paths ranked. MCP/OpenClaw/Agent Skills convergence. Decision tree: when to abstract, what's already portable. |
| 9 | Tools | **9/10** | **9.5/10** | 10-tool table with full input schemas AND return schemas. `dispatchTool` pattern with hooks + overlay documented. Agent can implement the entire tool registry from this table. |
| 10 | Framework Choice | **9/10** | **9.5/10** | LangGraph justified. Exact dependency versions. Full `StateGraph` wiring skeleton (compile-ready code). Acceptance criteria. Agent can scaffold the graph directly. |
| 11 | Persistent Loop | **9/10** | **9.5/10** | 6 REST routes with request/response types. WebSocket message contract (7 message types, typed). Context compaction mechanism (structured summary, not truncation). Lifecycle + restart recovery. Acceptance criteria. |
| 12 | Token Budget | **9/10** | **9.5/10** | Updated 2026 prices. Model tiering code (`MODEL_CONFIGS`). `TokenBudget` interface with `checkBudget()` enforcement. `CostTracker` instrumentation (per-node breakdown, cache metrics). Prefix caching design (80%+ target, cost impact). |

**ShipYard average: Research 8.8, Agent-Ready 9.0**

**Gap Analysis additions (from audit):**
- Prefix caching design: static prefix structure, `cache_control` implementation, 80%+ target, cost impact ($200→$50)
- SWE-bench context: 22-point scaffold swing validates architecture-over-model approach
- Fast Apply: 7B model, $0.80/M tokens, future tier-4 optimization
- Context compaction: structured summary (OpenCode pattern), not naive truncation
- Cost instrumentation: `CostTracker` type, per-node breakdown, cache hit reporting
- Git worktree isolation: acknowledged as alternative to hash-based conflict detection

---

## Audit Presearch (7 categories)

| # | Category | Research | Agent-Ready | Notes |
|---|----------|----------|-------------|-------|
| 1 | Type Safety | **9/10** | **8/10** | AST-based counting, before/after deltas, per-package breakdown. Reproducible commands. An agent could re-run the exact same measurement. |
| 2 | Bundle Size | **9/10** | **8/10** | source-map-explorer, depcheck, per-chunk sizes, gzip. Concrete artifacts. Agent could replicate and compare. |
| 3 | API Response Time | **8/10** | **7/10** | apache bench at 3 concurrency levels, seeded volume, P50/P95/P99. Good but the isolated DB setup instructions are scattered. |
| 4 | DB Query Efficiency | **8/10** | **7/10** | EXPLAIN ANALYZE, query log capture, N+1 detection. Index gaps identified. Missing: migration SQL for the fixes (agent would need to write it). |
| 5 | Test Coverage | **8/10** | **6/10** | 3x repeated runs, coverage numbers, flaky set identified. But the "fix the flaky tests" part is narrative, not structured. Agent would need to diagnose from scratch. |
| 6 | Runtime Edge Cases | **7/10** | **5/10** | Malformed-input matrix is good. But error boundary inventory is prose. No systematic "test this, expect that" table an agent could execute. |
| 7 | Accessibility | **8/10** | **6/10** | Lighthouse + axe + VoiceOver. 5-page keyboard matrix. Concrete. But the remediation steps are described in narrative, not as a checklist with acceptance criteria. |

**Audit average: Research 8.1, Agent-Ready 6.7**

---

## Summary

| Presearch Area | Research Avg | Agent-Ready Avg | Verdict |
|---------------|-------------|-----------------|---------|
| FleetGraph | 6.6 | **5.7** | Most docs written for a human PM. Strong on decisions, weak on typed contracts and implementation-ready specs. Items 04 and 10 are exceptional; 01, 03, 08 are thin. |
| ShipYard | 7.3 | **7.1** | Best agent-alignment of the three. "What I'd take / do differently" format + reuse tables + tool specs are directly consumable. Multi-agent and persistent loop sections are weakest. |
| Audit | 8.1 | **6.7** | Strongest raw research (measured, reproducible, before/after). But written as a narrative report for a grader, not as runnable acceptance criteria for an agent. |

**Overall gap: research quality averages 7.3, but agent-readiness averages only 6.5.** The consistent miss is: decisions and rationale are well-documented (human-readable), but typed interfaces, state machines, code skeletons, and test vectors that an agent could directly consume are underspecified.

### Top 3 Agent-Ready Items
1. FleetGraph #04 (LangGraph/LangSmith) -- 9/10
2. ShipYard #5 (File Editing Strategy) -- 9/10
3. ShipYard #4 (Software Factory Audit) -- 9/10

### Bottom 3 Agent-Ready Items
1. FleetGraph #01 (Presearch Before Code) -- 3/10
2. FleetGraph #08 (Real Data/Deployment) -- 3/10
3. FleetGraph #03 (Context Chat) -- 4/10

### What Would Make These 10/10 Agent-Ready

For any presearch item to score 10/10 agent-ready, it needs:

1. **Typed contracts** -- TypeScript interfaces for every input/output boundary
2. **Code skeletons** -- Starter files an agent can populate (not just describe)
3. **Test vectors** -- "Given X input, expect Y output" tables
4. **Decision trees** -- Explicit if/else routing, not prose descriptions
5. **Migration-ready schemas** -- DDL, not abstract entity descriptions
6. **Dependency list** -- Exact packages + versions + install commands
7. **Acceptance criteria** -- Boolean pass/fail, not subjective quality prose
