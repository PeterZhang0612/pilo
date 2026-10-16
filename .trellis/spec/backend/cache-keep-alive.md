# Prompt Cache Keep-alive

## 1. Scope / Trigger

Apply to model cache settings, background Pi requests, idle-process retention and
chat status notices. Owners: `runtime/cache_keep_alive.rs`,
`storage/cache_keep_alive.rs`, `crates/pilo-server/extensions/cache-keep-alive.js`,
`use-cache-keep-alive-status.ts` and shared `CacheKeepAliveNotice`.

## 2. Signatures

- Tauri `cache_keep_alive_settings_list(connectionId)` and
  `cache_keep_alive_settings_set(settings)`.
- Authenticated HTTP `GET /api/v1/cache-keep-alive/settings?connectionId=...`
  and `POST` to that path with the settings directly.
- Settings: `{ connectionId, provider, modelId, enabled, cacheTtlSeconds,
  idleKeepAliveSeconds, updatedAtMs }`.
- SQLite `model_cache_keep_alive_settings`: primary key
  `(connection_id, provider, model_id)`, Connection FK with delete cascade.
  Revisions are allocated atomically with `MAX(now, previous + 1)`.
- Built-in selector `{ id: "cache-keep-alive" }`; private extension command
  `/pilo-cache-keep-alive <settings-array JSON>`.
- `ChatSessionState.cacheKeepAlive` is nullable. Widget
  `pilo.cache-keep-alive.v1` contains one JSON line with readiness,
  status/reason, provider/model, expiry/next-request timestamps, request count,
  nullable cumulative uncached `inputTokens`, cache read/write tokens, output
  tokens and nullable estimated cost. Older Widgets may omit `inputTokens`;
  the Host defaults it to null.

## 3. Contracts

- Default off; UI defaults TTL to 300 seconds and idle window to 1,800 seconds.
  Settings belong to the original project's Connection, not its execution
  Connection. Normal chat loads the extension; model-catalog probes do not.
- Host requires the generation's Widget readiness and loaded built-in before
  sending the private command. Configuration never starts Pi, runs an Agent
  turn or touches idle-cache user recency. Failures must not fail primary chat.
- Capture only enabled normal requests, in memory: restored model context,
  observed provider payload and model identity. Captured provider payload size
  is capped at 16 Mi UTF-16 code units. Payload replay only supports Anthropic Messages,
  OpenAI Responses (including the custom `openai-responses-ws` API) and OpenAI
  Completions with a safe one-token output cap; active Anthropic thinking,
  previous-response references and resolved model identity changes are rejected.
  The custom WS adapter captures the full normalized body before continuation
  optimization. Its `onPayload` replacement runs after normalization, so replay
  preserves `instructions`, `input` and tools and restores `max_output_tokens: 1`.
  Continue using Pi's registered adapter for authentication and transport; do not
  normalize the captured body again or rewrite the model's API to HTTP Responses.
  No independent provider SDK or Pi config writes.
- Only `agent_settled` starts the idle window. Schedule at 90% of configured TTL;
  skip dispatch after 95%. Each request has zero retries and a 15-second deadline,
  further bounded by idle-window expiry. Successful requests do not extend that
  window. Cache miss, timeout or failure stops until another normal request.
- Stop/abort on a new normal run, model/thinking changes, Session switch/fork/tree,
  compaction or shutdown. Session name and auxiliary usage entries do not change
  context identity. Reject late results after snapshot/branch/config invalidation.
- Suppress Pi's native warming decision only for Pilo-enabled model policies.
  Active scheduled/warming leases are outside the ordinary idle-cache budget;
  expired leases are evictable again. Never manufacture user activity.
- Desktop and WebUI share the status notice above the composer. Consume their
  existing event channels and read current Host status on status events,
  activation, focus or reconnect. Do not replay stale Widget JSON as truth.
  Never write notices into conversation history, send desktop notifications or
  emit a toast on every refresh. Settings-dialog polling is read-only.
  Usage copy shows the cumulative token cache hit rate, not raw cache-read
  tokens: `cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens)`.
  Missing input usage or a zero denominator displays `—`, never an assumed 100%.
  Scheduled notices (including `warmed`) stay hidden until 30 seconds before
  `nextWarmAtMs`; a local display timer reveals them without polling or sending
  requests. A scheduled status without a next request stays hidden. Warming and
  terminal/error statuses retain their existing visibility rules.
  The shared notice has a manual close button (44px on coarse pointers), no
  auto-dismiss timer. Closing only hides it for the mounted session view;
  status refreshes never reopen it and background warming continues unchanged.
  Both entry points key the notice by runtime session key to isolate dismissal.
- Costs are estimates from provider usage. Missing usage or an interrupted request
  makes the cumulative estimate unknown rather than claiming a zero-cost call.

## 4. Validation & Error Matrix

| Input / condition | Result |
| --- | --- |
| Missing Connection | Settings operation fails |
| Empty provider/model, provider >256 bytes, model >512 bytes | Save rejected |
| TTL outside 10–86400 seconds or idle window outside 60–86400 seconds | Save rejected |
| Missing/unsupported extension readiness | No private prompt sent |
| Custom `openai-responses-ws` full captured request | Replay via registered adapter with `max_output_tokens: 1` |
| Unsupported captured request | Unavailable status; no replay |
| Expired cache/window | Stop without issuing another request |
| Cache read tokens absent/zero, error or timeout | Stop; no retry/rebuild loop |

## 5. Good / Base / Bad Cases

- Good: an enabled session settles, warms while another chat is selected and
  stops at its original idle deadline; returning shows current Host status.
- Base: no saved row means no Pilo warming requests or retained payloads.
- Bad: repeatedly rebuilding a missed cache, resetting the window after warming,
  using a model-catalog probe for warming, or turning status into chat messages.

## 6. Tests Required

Only add/run tests when authorized. Cover independent Connection/model policies,
revision races, private-command readiness, exact observed-prefix replay/output cap
(including custom WS normalization followed by `onPayload`, preserved instructions,
input/tools/reasoning, unchanged source payload and rejected response references),
expiry and missed-deadline skips, late aborted responses, cache-miss stop, model
and branch invalidation, metadata-only renames, idle eviction exemption/release,
and identical quiet notice behavior across desktop/WebUI reconnects.

## 7. Wrong vs Correct

Wrong: browser `setInterval` starts paid requests while the page is mounted.
Correct: Pi owns bounded warming timers; browsers only render Host status.

Wrong: failed or aborted calls add zero to a supposedly known bill.
Correct: preserve available usage counters and mark uncertain cost as unknown.
