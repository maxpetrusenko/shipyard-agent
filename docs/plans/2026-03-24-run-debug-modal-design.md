# Run Debug Modal Design

**Goal:** make the reply-level `i` button always useful by opening a compact debug modal with trace info, model info, timestamps, and routing clues.

## Scope

- Keep the existing reply-level `i` affordance.
- Replace dead-end trace behavior with a modal.
- Add a dedicated debug snapshot endpoint.
- Persist only the minimal run metadata needed for stable debug output.

## Decisions

### UI

- Clicking `i` opens a modal, never direct-opens a trace URL.
- The modal shows:
  - primary model / execution path
  - resolved stage models
  - run id
  - phase
  - thread kind
  - queued / started / saved timestamps
  - queue wait and duration
  - token usage
  - external trace URL when present
  - local debug trace URL always
  - error text when present
- Modal actions:
  - Open trace
  - Copy trace URL
  - Open run JSON

### Data

- Extend `RunResult` with:
  - `queuedAt`
  - `startedAt`
  - `runMode`
  - `executionPath`
  - `modelOverride`
  - `modelFamily`
  - `modelOverrides`
  - `resolvedModels`
- Local ask shortcuts record `executionPath=local-shortcut` so the modal does not falsely claim a model was used.
- Graph runs record resolved per-stage models once at run start so later debug output is stable.

### Server

- Add `src/server/run-debug.ts` as the single builder for debug snapshots.
- Add `GET /api/runs/:id/debug`.
- Local trace fallback is the debug endpoint itself, so trace access is always available.

### Modularity

- Keep dashboard modal UI in a dedicated module instead of growing `dashboard.ts`.
- Keep debug snapshot derivation out of routes.

## Risks

- Older persisted runs will not have new metadata. Fallbacks must still produce useful debug output.
- Ask local shortcuts must show `local-shortcut`, not inferred chat defaults.

## Validation

- Route test for `/api/runs/:id/debug`.
- Loop test for new metadata persistence on local ask and graph runs.
- Dashboard tests for modal hook and debug button action.
