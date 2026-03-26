# Operational Metrics Reference

All metrics are exposed at `GET /api/metrics` as JSON counters/gauges/timings. Each metric
follows the `shipyard.<domain>.<name>` naming convention. The endpoint also
returns a `help` object mapping each metric name to a human-readable
description.

## Metric Table

| Metric Name | Type | Description | Fires When |
|---|---|---|---|
| `shipyard.requests.total` | counter | Total HTTP requests received | Every inbound HTTP request |
| `shipyard.requests.errors` | counter | Unhandled errors in HTTP request processing | Express global error handler triggers |
| `shipyard.requests.by_status.{code}` | counter | HTTP responses by status code | Every HTTP response (suffixed with status code) |
| `shipyard.requests.by_route.{path}` | counter | HTTP requests by route path | Every HTTP request (suffixed with URL path) |
| `shipyard.auth.unauthorized` | counter | Requests rejected by Bearer auth | `SHIPYARD_API_KEY` set and request lacks valid Bearer token |
| `shipyard.ratelimit.blocked` | counter | Requests blocked by rate limiter (total) | Rate limit exceeded for any scope |
| `shipyard.ratelimit.blocked.scope.{scope}` | counter | Requests blocked per rate-limit scope | Rate limit exceeded (suffixed with scope name like `run`, `invoke`) |
| `shipyard.runs.submitted` | counter | Runs submitted via POST /run | POST /api/run called with valid instruction |
| `shipyard.runs.completed` | counter | Runs that completed successfully | POST /api/run resolves to a 200 response |
| `shipyard.runs.failed` | counter | Runs that failed | Reserved for run failure tracking |
| `shipyard.runs.rejected_queue_full` | counter | Run submissions rejected (queue full) | POST /api/run when queue length >= SHIPYARD_MAX_QUEUE_LENGTH |
| `shipyard.followup.attempt` | counter | Follow-up requests received | POST /api/runs/:id/followup called |
| `shipyard.followup.success` | counter | Follow-ups successfully queued | Follow-up instruction accepted and queued |
| `shipyard.followup.rejected_queue_full` | counter | Follow-ups rejected (queue full) | POST /api/runs/:id/followup when queue full |
| `shipyard.webhooks.received` | counter | GitHub webhook deliveries received | POST /api/github/webhook called |
| `shipyard.webhooks.dedupe_hit` | counter | Webhook dedup cache hit (exact match) | Delivery ID found in dedup index and event still exists |
| `shipyard.webhooks.dedupe_miss` | counter | Webhook dedup cache miss | Delivery ID not found in dedup index |
| `shipyard.webhooks.dedupe_stale` | counter | Stale dedup index entries pruned | Dedup index points to an event that was already evicted |
| `shipyard.webhooks.dedupe_duplicate` | counter | Duplicate webhook response served | Exact duplicate delivery detected; cached response returned |
| `shipyard.webhooks.rejected` | counter | Webhooks rejected (sig/payload) | Invalid HMAC signature or unparseable JSON body |
| `shipyard.webhooks.queue_full` | counter | Webhooks rejected (queue full) | Valid /shipyard command but run queue at capacity |
| `shipyard.webhooks.ack_failed` | counter | Ack comment POST non-OK | GitHub Issues API returns non-2xx for ack comment |
| `shipyard.webhooks.ack_error` | counter | Ack comment POST exception | Network or auth error posting ack comment |
| `shipyard.invoke.received` | counter | External invocations received | POST /api/invoke called |
| `shipyard.invoke.batch_received` | counter | Batch invocations received | POST /api/invoke/batch called |
| `shipyard.invoke.idempotency_hit` | counter | Idempotency cache replay | Request with X-Idempotency-Key matched cached response |
| `shipyard.retries.single` | counter | Single-event retries | POST /api/invoke/events/:id/retry called |
| `shipyard.retries.batch` | counter | Batch retry requests | POST /api/invoke/events/retry-batch called |
| `shipyard.retries.failed` | counter | Failed retry attempts | Retry target not found, not replayable, or queue full |
| `shipyard.llm.cache_read_tokens` | counter | Prompt cache read tokens | Anthropic usage reports cached input/read tokens |
| `shipyard.llm.cache_write_tokens` | counter | Prompt cache write tokens | Anthropic usage reports cache creation/write tokens |
| `shipyard.llm.compaction.anthropic_applied` | counter | Anthropic compaction applications | Anthropic message compaction drops old turns |
| `shipyard.llm.compaction.openai_applied` | counter | OpenAI compaction applications | OpenAI message compaction drops old turns |
| `shipyard.llm.compaction.messages_dropped` | counter | Total dropped messages during compaction | Any compaction pass removes historical messages |
| `shipyard.llm.compaction.chars_saved` | counter | Approximate character savings from compaction | Compaction computes pre/post prompt size delta |
| `shipyard.events.stored` | counter | Events stored in ring buffer | recordInvokeEvent() adds a new event |
| `shipyard.events.evicted` | counter | Events evicted (overflow) | Ring buffer exceeds SHIPYARD_INVOKE_EVENT_MAX |
| `shipyard.ws.connections_opened` | counter | WebSocket connections opened | Client connects to /ws |
| `shipyard.ws.connections_closed` | counter | WebSocket connections closed | Client disconnects from /ws |
| `shipyard.ws.auth_unauthorized` | counter | WebSocket auth rejections | /ws connection attempt with invalid credentials |
| `shipyard.ws.backpressure_terminated` | counter | WS terminated (backpressure) | Client bufferedAmount exceeds SHIPYARD_WS_MAX_BUFFERED_BYTES |
| `shipyard.request.duration_ms.le_{bucket}` | histogram | Request duration bucket | Every response; bucket values: 25, 50, 100, 250, 500, 1000, 2500, 5000 |
| `shipyard.request.duration_ms.gt_5000` | histogram | Request duration > 5s | Response took longer than 5000ms |

## Usage

```bash
# Fetch all counters + gauges + timings + descriptions
curl -s http://localhost:4200/api/metrics | jq .

# Get just the help map
curl -s http://localhost:4200/api/metrics | jq .help
```

## Adding New Metrics

1. Add the metric name to the `METRICS` const in `src/server/ops.ts`.
2. Add a description to the `METRICS_HELP` record in the same file.
3. Use `OPS.increment(METRICS.YOUR_NEW_METRIC)` at the call site.
4. Add the metric to this table.
5. Run tests: the uniqueness and help-coverage tests will catch gaps.
