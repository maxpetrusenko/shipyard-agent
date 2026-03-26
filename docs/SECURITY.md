# Security Model

## Auth surfaces

- Global API auth (`SHIPYARD_API_KEY`): protects `/api/*` except readiness/metrics/version/health endpoints explicitly exempted in `app.ts`.
- Invoke auth (`SHIPYARD_INVOKE_TOKEN`): protects invoke/retry/dead-letter replay paths.
  - Accepted headers: `X-Shipyard-Invoke-Token` or `Authorization: Bearer ...`.
  - If unset: server allows requests and increments `shipyard.security.unprotected_invoke`; logs one startup warning on first request.
- Webhook auth (`GITHUB_WEBHOOK_SECRET`): validates `X-Hub-Signature-256` with HMAC-SHA256.

## HMAC request signing middleware

`src/server/hmac-auth.ts` supports generic request signing for protected endpoints.

Requirements:
- `SHIPYARD_HMAC_SECRET` must be set to enable validation.
- Raw body is required when enabled.
- Add body parser verify hook:

```ts
import express from 'express';
import { saveRawBody } from './server/hmac-auth.js';

app.use(express.json({ verify: saveRawBody }));
```

Failure mode:
- If raw body is missing and HMAC is enabled, middleware returns `500` with:
  - `HMAC auth requires express.json({ verify: saveRawBody }) middleware`

## CSRF posture

Dashboard settings endpoints are local-operator oriented.

Mitigation implemented:
- Dashboard POST calls include `X-Requested-With: XMLHttpRequest`.
- `/api/settings/ack-template` enforces this header and returns `403` when missing.

Limitations:
- This is a lightweight check, not full CSRF token framework.
- For remote multi-user deployments, add same-origin CSRF tokens for all state-changing routes.

## Header sanitization

Dead-letter persisted headers remove sensitive keys using substring match (case-insensitive), including:
- `authorization`
- `x-hub-signature`
- `x-hub-signature-256`
- `cookie`
- `set-cookie`
- `x-api-key`
- `x-auth-token`
- `proxy-authorization`

This also redacts partial keys like `X-Custom-Authorization`.

## Webhook guardrails

- Bot-loop prevention: skip bot senders via sender type/login heuristics.
- Sender policy: allow/deny by authors or role associations via:
  - `SHIPYARD_WEBHOOK_ALLOWED_AUTHORS`
  - `SHIPYARD_WEBHOOK_ALLOWED_ROLES`
- Command extraction uses escaped command prefix regex to avoid regex injection (`SHIPYARD_COMMAND_PREFIX`).

## Dashboard XSS protections

- Settings ack-template preview writes preview with `textContent`, not `innerHTML`.
- Retry event drawer escapes user/event fields before HTML interpolation.
- Shared `esc(...)` is required for user-controlled values inserted into template strings.

## Operational observability for security

- `/api/metrics` includes counters/gauges/timings + audit stats.
- Audit log tracks privileged operations and rotates files after 10MB with up to 5 retained rotations.
- `/api/health` includes persistence health metadata:
  - `persistence.healthy`
  - `persistence.lastError`
  - `persistence.lastWriteAt`

## Deployment checklist

1. Set `SHIPYARD_API_KEY`.
2. Set `SHIPYARD_INVOKE_TOKEN`.
3. Set `GITHUB_WEBHOOK_SECRET`.
4. If using HMAC middleware, wire `express.json({ verify: saveRawBody })`.
5. Configure webhook sender allowlists/roles where needed.
6. Verify `/api/metrics` and audit log persistence are enabled in your runtime.
7. If exposing dashboard outside localhost, implement full CSRF tokens for all POST/DELETE APIs.
8. Ensure logs/results storage permissions prevent untrusted user read access.
