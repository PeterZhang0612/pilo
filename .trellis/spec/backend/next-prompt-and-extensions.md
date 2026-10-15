# Next Prompt Prediction and Built-in Extensions

## 1. Scope / Trigger

Apply when changing Connection prediction settings, input assistance, Pi launch
selection, or Server-owned extension deployment. Prediction is not an Agent turn:
Pi JSONL remains authoritative and neither conversation storage nor the primary
model may be changed by a prediction.

Owners: `runtime/next_prompt.rs` (Host policy), `storage/next_prompt.rs` (SQLite),
`crates/pilo-server/src/extensions.rs` (deployment), and
`crates/pilo-server/extensions/next-prompt.js` (Pi model call). Desktop and WebUI
share `useNextPrompt`, `useNextPromptSettings`, settings fields and `ChatComposer`.

## 2. Signatures

- Tauri `next_prompt_settings_get(connectionId) -> NextPromptSettings`;
  `next_prompt_settings_set(connectionId, enabled, model) -> NextPromptSettings`;
  `next_prompt_request(request: NextPromptRequest) -> ()`.
- Authenticated HTTP `GET /api/v1/next-prompt/settings?connectionId=...`;
  `POST /api/v1/next-prompt/settings` with `{ connectionId, enabled, model }`;
  `POST /api/v1/next-prompt/request` with the request directly, returning `{ ok: true }`.
- `PiloClient.loadNextPromptSettings(connectionId)`,
  `saveNextPromptSettings(connectionId, enabled, model)`, and
  `requestNextPrompt(request)` use those same Host services.
- Settings: `{ connectionId, enabled, model: null | { provider, id }, updatedAtMs }`.
- Request: `{ sessionKey, sessionId, requestId, generation, revision, cancel?: boolean }`.
- SQLite `connection_next_prompt_settings(connection_id TEXT PRIMARY KEY
  REFERENCES connections(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0
  CHECK(enabled IN (0,1)), provider TEXT NULL, model_id TEXT NULL,
  updated_at_ms INTEGER NOT NULL)`. A CHECK requires provider/model_id both null
  or both present.
- Pi `pi.start` adds `builtinExtensions: BuiltinExtension[]`, defaulting to `[]`.
  The internally tagged protocol enum uses `{ id: "next-prompt" }`,
  `{ id: "model-catalog" }`, or `{ id: "ssh-workspace", config }`.
  Existing `extensions: string[]` still means inline source, not file paths.

## 3. Contracts

### Settings and Host requests

- No row returns `enabled: false`, `model: null`, `updatedAtMs: 0`. Null means
  follow the chat model. Disabling in the UI preserves the selected model.
- One UPSERT stores all fields and allocates `MAX(now, previous + 1)` as revision.
  Only a successful write broadcasts `{ type: "next_prompt_settings_changed",
  settings }`, with no sessionKey, projectId or process generation.
- The settings key is the original project's Connection, not the execution
  Connection. Local Pi for an SSH workspace resolves models in Local Pi's registry.
- Requests only look up an existing chat process; never ensure/start Pi. Host
  injects the saved model, requires enabled + matching revision for generation,
  and checks project, generation, initialization, idle flags and loaded built-in.
  Cancellation remains allowed for an old revision or a busy process.
- Before any private prompt, Host requires this process generation's raw
  `setWidget("pilo.next-prompt.ready.v1", ["ready"])` handshake. Starting,
  stopping or failing clears readiness. Missing/unsupported extensions must not
  turn `/pilo-next-prompt ...` into an ordinary user message.
- `ChatSessions::send_input_assistance` bypasses normal prompt work flags and
  idle-cache recency. Transport send has a 2-second timeout. Use a distinct
  `pilo-next-prompt-<requestId>-<cancel>` RPC ID: an uncorrelated response must
  not clear the main turn's pending prompt ownership.

### Extension and result channel

- Only a live `agent_settled` establishes the eligible Session/leaf snapshot.
  Host's `assistant_message_end` is its existing typed mapping, not a low-level
  assistant/tool turn end. Never fall back to `agent_end`.
- `/pilo-next-prompt <JSON>` is a registered RPC extension command. Its handler
  starts background `ctx.modelRegistry.streamSimple(...).result()`, then returns
  promptly. Both readiness checks require `streamSimple`. Do not use `complete`:
  its API-specific stream path does not resolve Pi virtual models, including when
  following the current chat selection. The provider-neutral path routes them
  without changing the chat model. It never
  calls `sendMessage`, `setModel`, or an independent provider SDK.
- Target is `registry.find(provider, id)` when explicit, otherwise `ctx.model`.
  Missing model/authentication produces unavailable; no silent fallback.
- Context uses `buildSessionProjection().entries` to honor compaction/context
  edits: bounded user/assistant text and summaries; tool name + success/error
  only. No thinking, images, tool arguments/output, filesystem reads or full JSONL.
  Per-text clipping is 2,000 characters and serialized JSON is at most 10,000
  characters, including escape expansion. Preserve first user intent and latest
  summary when they fit, then add recent entries within the remaining budget.
- One call: 128 max tokens, `maxRetries: 0`, AbortController timeout 5 seconds.
  Race the model result against the deadline: abort alone does not settle a
  provider Promise. A timeout publishes `unavailable` to every waiting request
  without waiting for provider shutdown; late resolution/rejection cannot publish
  again. A client cancel aborts without publishing. A request whose settled snapshot no longer
  matches (no settle, busy, session/leaf changed) is answered `cancelled`
  instead of leaving the client to its own timer.
  Prompt follows Claude Prompt Suggestion Generator v2, with attribution/MIT
  notice inside the script. No obvious next step means silence, not forced continue.
- Jobs deduplicate by Session ID + leaf ID + settings revision + resolved model
  identity. Up to 32 request IDs share one pending/completed job; cancel removes
  only that ID and aborts when no subscribers remain. New run, model selection,
  session navigation/compaction/shutdown resets the job and invalidates
  subscribed results.
- `setWidget("pilo.next-prompt.v1", [JSON.stringify(result)])` carries
  `{ requestId, sessionId, leafId: string | null, revision, text: string | null,
  status: "ready" | "empty" | "cancelled" | "unavailable" }`. This is a private
  Widget namespace, not a new generic Pi RPC/conversation event.
- Shared decoder accepts one JSON line of at most 4,096 characters; safe integer
  revision; string IDs; nullable leaf; null or one-line text of 1–160 characters;
  no backticks. Extension also rejects quotes, multiple sentences and non-CJK
  output outside 2–12 words. Prediction text is not persisted or traced.

### Frontend lifecycle

- Trigger only in an interactive active view with empty draft, no attachments,
  enabled settings, and no blocking UI. Window blur or document hiding must not
  block generation, cancel pending work or discard results: allow background
  generation and retain suggestions for returning to the foreground. Switching
  the selected Session still invalidates work. Wait for idle after the live
  completion; do not generate on mount, focus, state hydration or replay.
- Event handlers read the latest committed options from a ref updated in a
  layout effect, not by mutating refs during render. Invalidation effects use
  explicit identity/editor/transport dependencies even when cleanup does not read
  them; explain that deliberate trigger contract when lint needs a local exception.
- Web passes `chat.identifiedSessionId`, not `chat.chatState.sessionId`: the latter
  is a statistics projection and does not carry the live Pi Session identity.
- Desktop uses the existing multiplexed runtime channel. Web feeds its existing
  socket frames into the shared hook, establishing a live sequence floor from
  hello/resync and advancing it per event. Replay can update settings, never
  trigger predictions. Foreground/reconnect reloads authoritative settings only.
  A healthy Web foreground return probes the existing socket instead of forcing
  reconnect; ping/pong is consumed by the adapter, never forwarded to this hook.
  Actual transport failure still invalidates work. See [Remote WebUI](./remote-webui.md).
- Result matching includes requestId, Session ID, Pi generation, Connection,
  model/config key and revision. Input/attachments, Esc (even while pending),
  submit, run, dialog/readOnly, transport/session/model/config changes
  clear results and best-effort cancel. Saving settings locally already disables
  eligibility and cancels pending work, before the Host reply arrives; failure
  retains formal settings but never restores the old suggestion. A 7-second
  client timer discards late work.
- `randomId()` is a correlation ID helper, not a pairing proof. It works on
  ordinary HTTP LAN origins where `crypto.randomUUID()` may not exist.
- Ghost Text uses textarea placeholder, never its value. Empty-draft sizing uses
  the configured rows, not placeholder scrollHeight; predictions must not enlarge
  the composer. The adoption control overlays the top-right with reserved text
  padding: `→ Tab` on fine pointers, a tap label on coarse pointers. Pure Tab only
  adopts with no modifiers, no IME composition and no existing completion menu.
  Other keyboard behavior is preserved; point/touch adoption only fills the draft.
- Shared settings fields use cached Host catalogs, preserve unknown configured
  identities, and do not spawn a model probe. Desktop has a Connection settings
  tab; desktop and wide WebUI expose the shared session-header settings popover
  (the unavailable hint lives inside it). Narrow WebUI (`isNarrow`, below 1024px)
  does not mount this button or popover; prediction and adoption remain unchanged.
  Neither composer displays a prediction settings icon. Use coarse-pointer 44px
  targets and the existing viewport/safe-area layout.

### Fixed deployment

- Server embeds three single-file sources from `crates/pilo-server/extensions/`
  and deploys them once at startup into `<runtime-root>/extensions/`. Unchanged
  content is left untouched; missing/changed files use same-directory create-new
  temporary files, sync and atomic rename. Temporary names include PID + nonce;
  they are deployment staging only, never Session extension paths.
- `PILO_SERVER_RUNTIME_DIR` is an absolute writable runtime root. Local debug
  embedded Server and release binary launchers explicitly supply it. Default
  release Local root is Windows `LOCALAPPDATA/pilo/server`, or POSIX absolute
  `XDG_CACHE_HOME/pilo/server` / `HOME/.cache/pilo/server`, never an install directory.
  Debug Local uses `pilo-dev/server` instead. WSL/SSH launchers explicitly use
  `$HOME/.cache/pilo/server` for release and `$HOME/.cache/pilo-dev/server` for debug.
  See [Manual development runtime builds](./quality-guidelines.md#manual-development-runtime-builds)
  for manual builds and cache isolation.
- Server maps only typed built-in IDs to canonical absolute deployed paths.
  Normal chat loads next-prompt; model probe loads model-catalog (plus SSH tools
  only when required by its profile); parallel/direct Pi load only their profile.
  A disabled setting does not unload the script, but causes no prediction calls.
- SSH config is child-only `PILO_SSH_WORKSPACE_CONFIG` JSON:
  `{ label, remoteCwd, sshArgs, sshEnvironment }`. Remove inherited config before
  optionally setting it. Never replace text in shared deployed source.
- User-installed extensions remain Pi-native. Inline-source compatibility remains
  for other callers, but these three production built-ins do not use it.
  `src-tauri/src/runtime/pi_ssh_workspace.js` is retained unchanged solely for the
  existing source-reading SSH test fixture; it has no production loading reference.
- The model-catalog probe resolves defaults serially: each setModel changes the
  same throwaway Pi session and must restore its baseline before the next model.
  Never parallelize this loop to satisfy no-await-in-loop.
- Extension-only changes affect Cargo embedded resources/binary fingerprint.
  For WSL/SSH dev, run `pnpm server:build` and restart Pilo/Pi; startup deploys
  the server and embedded plugins into the isolated dev runtime root.
  `sync-to-windows.sh` only syncs sources; build in the Windows checkout after sync.
  CI already covers the Server crate tree. No plugin hot reload, package manifest,
  bundle-hash or independent rollback.

## 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Unknown Connection | Command error / HTTP 400; no settings write |
| Empty/overlong model provider or ID (>256/>512 bytes) | Reject save; retain old settings |
| Invalid request ID (empty, >128 bytes, not ASCII alphanumeric/_/-), empty/>256-byte Session ID or >4096-byte session key | Reject request |
| Disabled/stale settings revision | Reject generation; cancellation may still proceed |
| Process absent, replaced, busy, uninitialized or not prediction-ready | Reject without starting Pi or ordinary prompt fallback |
| Missing model/auth, unsupported API, complete failure | Lightweight unavailable or no suggestion; primary chat unaffected |
| No next intent / invalid output | Null/empty; no automatic retry or generic continue |
| Timeout/cancel/late reply/replay | Invalidate or ignore; never overwrite real draft |
| Duplicate built-in ID / invalid SSH config | Reject Pi start before launch |
| Relative explicit runtime root / deployment IO failure | Server startup fails; no half-written script is loaded |

SSH config requires a POSIX absolute cwd without NUL, nonempty sshArgs with no
NUL, and nonempty environment keys without `=`/NUL and values without NUL. Do not
log SSH config, model credentials, prediction context or suggestion body.

## 5. Good / Base / Bad Cases

- Good: two clients receive one live settled leaf and request the same config;
  one complete call publishes their separate request IDs. One client typing
  cancels only its own interest. Adoption fills but does not send.
- Base: default disabled or viewing idle history starts neither Pi nor prediction;
  absent cached models still allows follow-chat configuration.
- Bad: old Web replay, changed settings, typed draft, fork or new run cannot
  resurrect a suggestion. Explicit unavailable targets must not use another model.

## 6. Tests Required (When Explicitly Authorized)

`tests/pi-next-prompt.test.ts` is included in `pnpm test:unit`. Its isolated Pi
mock verifies timeout completion when abort is ignored, shared subscribers,
completed timeout reuse, late success/failure suppression, per-request and final
subscriber cancellation, compaction invalidation and normal timer cleanup.

Remaining assertion points for future verification are not claims that these
behaviors have been run:

- Storage: defaults, paired model fields, monotonic concurrent UPSERT revisions,
  Connection cascade, unknown/invalid identities and preserving model on disable.
- Extension: bounded escaped JSON, summary/context-edit handling and exclusion of
  private content; no JSONL writes; physical and virtual model selection (explicit
  and follow-chat), missing streamSimple readiness, target/auth failure; timeout/no retry; shared
  pending/completed calls and per-request cancellation across Session/leaf changes.
- Host: readiness absent/loading failure sends no private prompt; new generation
  clears readiness; private prompt response does not change main active-turn flags;
  stale/busy/history requests never start Pi or touch idle retention.
- Frontend: background completion triggers generation; blur/hiding preserves
  pending work and results; foreground return does not regenerate. Preserve
  replay/duplicate completion, late config/load/transport replies, input,
  pending Esc, run/dialog/model/fork invalidation; completion menu priority,
  IME and ordinary Tab navigation; LAN HTTP correlation IDs; adopt never sends.
- Authorized Windows desktop and real mobile WebUI: shared settings both ways,
  narrow wrapping/touch targets/safe areas/keyboard inset. WSL is not desktop validation.
- Authorized Local/WSL/SSH deployment: first install, unchanged reuse, missing-file
  repair, extension-only rebuild, atomic replacement, and two SSH session configs.
  The legacy SSH fixture alone does not verify the new deployed script.

## 7. Wrong vs Correct

Wrong: `ensure()` an idle Session for prediction, send a private command without
knowing it loaded, or send it through normal chat prompt bookkeeping.

Correct: look up the existing process, require typed selection + readiness +
generation/idle checks, then use input-assistance send with its own RPC ID.

Wrong: `textarea.value = prediction`, direct `crypto.randomUUID()` on HTTP LAN,
or rewriting `ssh-workspace.js` to switch a Session's workspace.

Correct: use a separate ghost prop and explicit adoption, existing `randomId()`
for correlation, and child-process environment for SSH dynamic configuration.

Wrong: force WebSocket reconnect on every foreground return, or invoke
`modelRegistry.complete` on a virtual model selected for prediction.

Correct: probe the existing socket and reconnect only on failure; call
`modelRegistry.streamSimple(...).result()` so Pi resolves virtual routing.
