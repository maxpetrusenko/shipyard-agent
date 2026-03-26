# Reliability Report (2026-03-26)

This run validates retry/webhook reliability improvements and records current
soak behavior with exact commands and outputs.

## Commands Run

```bash
pnpm -s vitest run test/server/invoke-routes-retry.test.ts test/server/recovery-report.test.ts
pnpm -s vitest run test/runtime/loop-shortcuts.test.ts
./scripts/flake-check.sh 3
pnpm -s load:test -- --target both --concurrency 3 --duration 5
pnpm -s load:test -- --target retry --concurrency 2 --duration 3
```

## Test Evidence

- Retry/recovery suite: `27 passed`
- Loop shortcut suite: `6 passed`
- Flake check: `3/3 green` for `loop-shortcuts`
- Full done gate (same batch): `654 passed`

## Soak Evidence

Source artifacts:

- `results/load-test-20260326-142753.json`
- `results/load-test-20260326-142832.json`

Observed:

- Webhook soak (`concurrency=3`, `duration=5s`):
  - `823` requests
  - `100%` success (`200` only)
  - p95 `26ms`, p99 `37ms`
- Retry-batch soak (`concurrency=2`, `duration=3s`):
  - `21681` requests
  - `100%` success (`200` only)
  - p95 `1ms`, p99 `1ms`

## Fixes Applied During Soak Work

- `scripts/load-test.ts`
  - Fixed event query source filter (`github_webhook` -> `github`)
  - Fixed response parsing for `/api/invoke/events` shape (`array` or `{ events }`)
  - Added scoped Authorization header support (`invoke` / `retry` / `read`)
  - Fixed retry-batch payload key (`eventIds` instead of `ids`)
- `test/scripts/load-test.test.ts`
  - Updated payload assertions to `eventIds`

## Residual Risks

- Soak uses local environment only; no WAN jitter or external GitHub traffic.
- Retry batch currently hammers same replayable pool aggressively; this is good
  for stress, but not representative of real production mix.
