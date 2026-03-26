# API Reference

Base path: `/api`

Auth modes:
- Global API key: `Authorization: Bearer $SHIPYARD_API_KEY` (when configured)
- Invoke routes: `X-Shipyard-Invoke-Token` or bearer token (when `SHIPYARD_INVOKE_TOKEN` is set)
- Webhook signature: `X-Hub-Signature-256` (`sha256=...`) when `GITHUB_WEBHOOK_SECRET` is set

## Core Run APIs

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/run` | API key (optional global) | `instruction`, optional contexts/model overrides | `{ runId, ... }` | `400` invalid payload |
| POST | `/runs/:id/followup` | API key | `instruction`, optional model overrides | `{ runId, queued }` | `400` invalid/not found |
| POST | `/runs/:id/confirm` | API key | optional edited plan steps | `{ runId, confirmed }` | `404` |
| POST | `/runs/:id/resume` | API key | none | `{ runId }` | `404` |
| DELETE | `/runs/:id` | API key | none | `{ ok: true }` | `404/409` |
| GET | `/runs` | API key | query: `limit`,`offset` | `Run[]` | `500` |
| GET | `/runs/:id` | API key | none | `Run` | `404` |
| GET | `/runs/:id/debug` | API key | none | debug snapshot | `404` |
| GET | `/status` | API key | none | queue status | `500` |
| POST | `/cancel` | API key | none | `{ cancelled }` | `500` |
| POST | `/inject` | API key | `label`,`content`,`source?` | `{ success: true }` | `400` |
| GET | `/contexts` | API key | none | contexts | `500` |
| DELETE | `/contexts/:label` | API key | none | `{ success: true }` | `404` |

## Agent Control

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/agent/pause` | API key | none | `{ pauseRequested }` | `500` |
| POST | `/agent/resume` | API key | none | `{ resumed: true }` | `500` |

## Invoke + Webhook + Retry

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/invoke` | invoke token (optional) | `{ instruction, source?, eventType?, metadata? }` | `{ eventId, runId, status, correlationId }` | `400/401/409` |
| POST | `/invoke/batch` | invoke token (optional) | `{ items[] }` (max 20) | `{ results, total }` | `400/401` |
| GET | `/invoke/events` | API key | query: `limit,source,eventType,status,from,to` | `InvokeEvent[]` | `400` |
| GET | `/invoke/events/summary` | API key | query: filters + `windowMs,groupBy` | aggregate summary | `400` |
| POST | `/github/webhook` | webhook signature (optional by env) | GitHub webhook payload | `{ status, ... }` | `401/403` |
| POST | `/invoke/events/:id/retry` | invoke token | none | `{ eventId, runId, retryOf, status }` | `404/429/401/409` |
| POST | `/invoke/events/retry-batch` | invoke token | `{ eventIds[], dryRun?, maxAccepted?, abortOnQueueFull?, ordering? }` | batch summary | `400/401/409` |
| POST | `/invoke/events/retry-strategy` | invoke token | `{ strategy:'queue_full_recent', minutesBack?, dryRun? }` | `{ matched, retried, dryRun }` | `400/401` |
| GET | `/invoke/events/retry-preview` | API key | query: `eventIds=id1,id2` | retryability summary | `400` |

## Dead-Letter + Ops

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/dead-letter` | API key | query: `limit?` | dead-letter entries | `500` |
| GET | `/dead-letter/:id` | API key | none | entry | `404` |
| POST | `/dead-letter/:id/replay` | invoke token | none | `{ status:'replayed' }` | `400/401/404` |
| DELETE | `/dead-letter` | API key | none | `{ cleared }` | `500` |
| GET | `/providers/readiness` | public if global key middleware exempts | none | provider readiness | `500` |
| GET | `/memory` | API key | none | memory guard snapshot | `500` |
| GET | `/metrics` | public if exempt | none | `{ counters, gauges, timings, audit, timestamp }` | `500` |
| GET | `/version` | public if exempt | none | `{ version }` | `500` |
| GET | `/health` | public if exempt | none | `{ status, uptime, persistence }` | `500` |
| GET | `/healthz` | public if exempt | none | `{ status, uptime }` | `500` |
| GET | `/readyz` | public if exempt | none | `{ status, uptime }` | `500` |
| GET | `/invoke/events/error-budget` | API key | query: `windowMs?` | error budget snapshot | `500` |
| GET | `/recovery/report` | API key | none | recovery report | `500` |

## Settings + GitHub Connect

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/settings/status` | API key | none | runtime/settings status | `500` |
| POST | `/settings/model-keys` | API key | Anthropic/OpenAI keys | `{ ok: true, ... }` | `400` |
| GET | `/settings/ack-template` | API key | none | `{ template }` | `500` |
| POST | `/settings/ack-template` | API key + `X-Requested-With: XMLHttpRequest` | `{ template: string }` | `{ ok: true }` | `400/403` |
| GET | `/github/install/start` | API key | none | redirect to install flow | `400` |
| GET | `/github/install/callback` | API key | query callback params | popup HTML | `400` |
| POST | `/github/install/logout` | API key | none | `{ ok: true }` | `500` |
| POST | `/github/repos` | API key | `{ query? }` | `{ repos }` | `401/400` |
| POST | `/github/connect` | API key | `{ repoFullName }` | `{ ok, workDir, branch }` | `401/400` |

## Checkpoints

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/checkpoints` | API key | query: `limit` | `{ checkpoints }` | `500` |
| POST | `/checkpoints` | API key | `{ runId?, label?, filePaths? }` | checkpoint create output | `400` |
| POST | `/checkpoints/rollback` | API key | `{ checkpointId, dryRun?, filePaths? }` | rollback output | `400` |

## Benchmarks API

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/benchmarks` | API key | none | benchmark dataset | `500` |
| POST | `/benchmarks/snapshot` | API key | `{ targetDir, label }` | snapshot payload | `400` |

## Error format

Invoke/webhook/retry endpoints use structured API errors:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "details": { "optional": "context" }
}
```
