# Dashboard: Live Feed, Plan Confirm, and Token Optimization

> Read when: modifying dashboard, WebSocket events, plan node, or token cost structure.

## Status

- [x] Live edit feed via WebSocket (file_edit + tool_activity events)
- [x] Elapsed timer, step/token counters, transcript panel
- [x] write_file emits file_edit events (tier-4)
- [x] Plan node exploration streams tool_activity to dashboard
- [x] DB migration for token_input/token_output columns
- [ ] Plan doc upload per run
- [ ] Plan-then-confirm (show plan, user approves before execute)
- [ ] Repo map context (generate once, inject into every run)

## Architecture

### Live Feed (implemented)

```
hooks.ts                     loop.ts                    ws.ts              dashboard
  │                            │                          │                    │
  ├─ emitLiveFeed(event) ──►  setLiveFeedListener() ──► onLiveFeed() ──►  WS message
  │   file_edit               broadcastLiveFeed()        file_edit           renderEdit()
  │   tool (read/bash/grep)                              tool_activity       renderToolActivity()
```

- `LiveFeedEvent` union type in `hooks.ts` covers `file_edit` and `tool` events
- Module-level `liveFeedListener` set/cleared by `loop.ts` around `graph.stream()`
- `createRecordingHooks()` fires for execute node (edit_file + write_file)
- `createPlanLiveHooks()` fires for plan node (read_file, grep, glob, bash)

### Plan Doc Upload (planned)

Allow attaching a requirements/plan document per run:

1. Dashboard textarea or file upload for plan doc content
2. `POST /api/run` accepts optional `planDoc` field
3. Plan doc injected as a context entry (`source: 'user'`, `label: 'Plan Document'`)
4. Plan node sees it in `state.contexts` and scopes work accordingly

### Plan-then-Confirm (planned)

Two-phase run: plan first, then user approves before execution.

1. `POST /api/run` with `uiMode: "plan"`, or `{ instruction, confirmPlan: true }` when not using `uiMode`
2. Graph runs plan node only, returns `phase: 'awaiting_confirmation'`
3. Dashboard shows the step list, user can edit/trim/approve
4. `POST /api/runs/:id/confirm` with optional edited steps resumes execution
5. Skips plan node, starts at execute with the confirmed steps

### Repo Map (planned)

Cached file tree + key exports, injected as context to avoid re-exploration.

1. On server start (or on first run), generate repo map via `find + grep`
2. Store as a context entry (`source: 'system'`, `label: 'Repo Map'`)
3. Plan node receives it, reducing glob/grep rounds from ~8 to ~2
4. Refresh on file change or explicit invalidation

## Token Cost Analysis

Current cost per run (worst case):

| Phase | Model | Rounds | Est. tokens/round | Cost |
|-------|-------|--------|-------------------|------|
| Plan | Opus | 15 | ~8K in + ~2K out | $1.50-3.00 |
| Execute | Sonnet | 25 per step | ~10K in + ~4K out | $0.50-1.00/step |
| Verify | bash | 1 | 0 (no LLM) | $0.00 |
| Review | Opus | 1 | ~8K in + ~1K out | $0.15 |

Biggest levers:
- **Repo map**: saves 3-8 plan rounds (~$0.50-1.50/run)
- **Plan doc upload**: scopes the planner, fewer exploration rounds
- **Plan confirm**: prevents wasted execute tokens on wrong plan
- **Model routing**: use Haiku for plan exploration, Opus only for synthesis

## Files

| File | Role |
|------|------|
| `src/tools/hooks.ts` | LiveFeedEvent, emitLiveFeed, createPlanLiveHooks |
| `src/runtime/loop.ts` | setLiveFeedListener, broadcastLiveFeed, onLiveFeed |
| `src/server/ws.ts` | Forward file_edit + tool_activity to WS clients |
| `src/server/dashboard.ts` | Dashboard HTML/JS: edit feed, timer, transcript |
| `src/server/routes.ts` | REST API: /run, /inject, /cancel, /confirm |
| `src/graph/nodes/plan.ts` | Plan node: explores repo, produces steps |
| `src/graph/nodes/execute.ts` | Execute node: implements each step |
| `src/graph/builder.ts` | Graph wiring: plan → execute → verify → review |
| `src/graph/edges.ts` | Conditional routing after plan/review |
| `scripts/migrations/002-add-token-columns.sql` | DB fix for token columns |
