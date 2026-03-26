# Route Scope Matrix

Last updated: 2026-03-26

## Token Environment Variables
- `SHIPYARD_API_KEY`: global bearer auth for `/api/*` (except health/readiness/version/metrics/provider-readiness)
- `SHIPYARD_INVOKE_TOKEN`: invoke token for invoke/webhook/retry/dead-letter actions in invoke routes
- `SHIPYARD_RETRY_TOKEN`: retry-only scope (used by `requireScope` helpers)
- `SHIPYARD_ADMIN_TOKEN`: admin scope (implies retry + read in scope hierarchy)
- `SHIPYARD_READ_TOKEN`: read-only scope

## Global Middleware (`src/app.ts`)
- If `SHIPYARD_API_KEY` is set:
  - Requires `Authorization: Bearer <SHIPYARD_API_KEY>` for most `/api/*` routes
  - Exempt routes: `/api/health`, `/api/healthz`, `/api/readyz`, `/api/providers/readiness`, `/api/metrics`, `/api/version`

## Invoke Route Authorization (`src/server/invoke-routes.ts`)
- `authorizeInvoke()` checks `SHIPYARD_INVOKE_TOKEN` via either:
  - `Authorization: Bearer <token>`
  - `x-shipyard-invoke-token: <token>`
- If `SHIPYARD_INVOKE_TOKEN` is unset, invoke endpoints are open (subject to global API key middleware above).

## Scope Hierarchy (`src/server/auth-scopes.ts`)
- `full` implies `invoke`, `retry`, `admin`, `read`
- `admin` implies `retry`, `read`
- `invoke` implies `retry`

## Practical Route Groups
- Write/control routes (run/followup/inject/cancel/checkpoint/confirm/resume/delete/settings write):
  - protected by global `SHIPYARD_API_KEY` middleware when enabled
- Invoke/webhook/retry/dead-letter routes:
  - protected by `SHIPYARD_INVOKE_TOKEN` when set
  - also protected by global `SHIPYARD_API_KEY` when enabled
- Read ops routes (`/api/metrics`, `/api/providers/readiness`, `/api/version`, health):
  - intentionally public even when `SHIPYARD_API_KEY` is set

## Notes
- `requireScope()` is available for finer per-route token partitioning and is tested in `test/server/auth-scopes.test.ts`.
- Current invoke routes use `authorizeInvoke()` directly; migrating selected endpoints to `requireScope()` is the next hardening step.
