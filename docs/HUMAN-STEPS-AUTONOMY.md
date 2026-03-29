# Human Setup Steps for High-Autonomy Mode

Owner: Max  
Updated: 2026-03-25

This checklist is the human side of setup while Shipyard implementation continues.

## 1) Claude Max / Anthropic OAuth (Required for plan login path)

Goal: run Anthropic via OAuth token (`ANTHROPIC_AUTH_TOKEN`) instead of API key.

Steps:
1. Obtain Anthropic OAuth token from your Claude Code / Max flow.
2. Open `http://localhost:4200/dashboard` and go to `Config`.
3. Paste token into `Anthropic auth token (Claude Max)` and click `Apply Keys`.
4. Confirm status shows `Anthropic mode: OAuth token`.

Notes:
- Setting OAuth token clears `ANTHROPIC_API_KEY` for that process.
- Runtime only; restart requires re-apply unless also persisted in `.env`.

## 2) Codex Max Plan Readiness (Required for future Codex-plan execution mode)

Goal: verify Codex CLI is installed and logged in with your ChatGPT plan.

Steps:
1. Install Codex CLI if missing:
```bash
npm i -g @openai/codex
```
or
```bash
brew install --cask codex
```
2. Login:
```bash
codex login
```
3. Confirm:
```bash
codex --version
```
4. In dashboard `Config`, confirm provider status reports:
- `Codex CLI: installed + logged in (plan ready)`

Notes:
- Current server uses OpenAI API key for OpenAI SDK calls.
- Codex CLI login is now surfaced as readiness signal for planned executor integration.

## 3) GitHub App Connector (Required for autonomous repo connect/PR loops)

Goal: fully configure install flow and repo connection.

Steps:
1. In GitHub App settings:
- Set **Setup URL** to your public Shipyard URL, for example `https://agent.ship.187.77.7.226.sslip.io/api/github/install/callback`
- Grant repo permissions needed for your workflow.
2. In `.env`, set:
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID` (or `GITHUB_APP_ID`)
- `GITHUB_APP_PRIVATE_KEY`
- Optional if proxy host/proto differs from the browser URL: `SHIPYARD_PUBLIC_BASE_URL`
3. Open `http://localhost:4200/settings/connectors/github`.
4. Click `Connect GitHub`, complete install. If GitHub leaves you on its install settings page, come back, load installations, choose yours, then load repos and connect target repo.

## 4) API Auth for Long Sessions (Recommended)

Goal: keep dashboard + settings authenticated in API-key mode.

Steps:
1. Set `SHIPYARD_API_KEY` in `.env`.
2. Open dashboard once with query:
```text
/dashboard?api_key=YOUR_KEY
```
3. UI stores key in localStorage (`shipyard_api_key`) and auto-attaches to API + WS.

## 5) Secure External Triggers (Recommended for automation)

Goal: protect async trigger endpoints (`/api/invoke`, `/api/invoke/batch`, `/api/invoke/events/:id/retry`).

Steps:
1. Set `SHIPYARD_INVOKE_TOKEN` in `.env`.
2. For automation callers (GitHub Action, webhook relay, Slack worker), send one of:
- `x-shipyard-invoke-token: <token>`
- `Authorization: Bearer <token>`
3. Verify:
```bash
curl -X POST http://localhost:4200/api/invoke \
  -H "Content-Type: application/json" \
  -H "x-shipyard-invoke-token: $SHIPYARD_INVOKE_TOKEN" \
  -d '{"instruction":"health check invoke"}'
```
4. Retry a recorded ingress event:
```bash
curl -X POST http://localhost:4200/api/invoke/events/<event-id>/retry \
  -H "x-shipyard-invoke-token: $SHIPYARD_INVOKE_TOKEN"
```
5. Retry multiple events in one call:
```bash
curl -X POST http://localhost:4200/api/invoke/events/retry-batch \
  -H "Content-Type: application/json" \
  -H "x-shipyard-invoke-token: $SHIPYARD_INVOKE_TOKEN" \
  -d '{"eventIds":["<event-id-1>","<event-id-2>"],"ordering":"oldest_first","abortOnQueueFull":true,"maxAccepted":1}'
```
6. Dry-run retryability (no new runs queued):
```bash
curl -X POST http://localhost:4200/api/invoke/events/retry-batch \
  -H "Content-Type: application/json" \
  -H "x-shipyard-invoke-token: $SHIPYARD_INVOKE_TOKEN" \
  -d '{"eventIds":["<event-id-1>"],"dryRun":true}'
```
7. Summary-only metrics with time window filters:
```bash
curl "http://localhost:4200/api/invoke/events/summary?from=2026-03-01T00:00:00.000Z&to=2026-03-31T23:59:59.999Z"
```

## 6) GitHub Autonomous Comment Triggers (Recommended)

Goal: let GitHub comments trigger Shipyard jobs automatically.

Steps:
1. Set `SHIPYARD_GITHUB_WEBHOOK_SECRET` in `.env`.
2. In your GitHub repo webhook settings:
- Payload URL: `http://<your-host>:4200/api/github/webhook`
- Content type: `application/json`
- Secret: same value as `SHIPYARD_GITHUB_WEBHOOK_SECRET`
- Events: `Issue comments`, `Pull request review comments`
3. In GitHub comments, use:
- `/shipyard run <instruction>`
- `/shipyard agent <instruction>`
- `/shipyard plan <instruction>`
- `/shipyard ask <instruction>`
  Repeated commands in the same GitHub issue conversation or pull-request review thread reuse the same Shipyard `runId`.
4. Monitor ingress:
```bash
curl "http://localhost:4200/api/invoke/events?limit=50"
```
5. Optional: enable ack comments back to GitHub thread:
- Set `SHIPYARD_GITHUB_WEBHOOK_ACK_COMMENTS=1`
- Optional formatting:
  - `SHIPYARD_GITHUB_WEBHOOK_ACK_PREFIX=Shipyard`
  - `SHIPYARD_GITHUB_WEBHOOK_ACK_STYLE=compact` (or `detailed`)
- Requires webhook payload to include `installation.id` and repository/issue metadata.

## 7) Optional: Codex readiness override flags (testing only)

For local test simulation only:
- `SHIPYARD_CODEX_CLI_FORCE_INSTALLED=1`
- `SHIPYARD_CODEX_CLI_FORCE_AUTHENTICATED=1`

Do not use these in production.
