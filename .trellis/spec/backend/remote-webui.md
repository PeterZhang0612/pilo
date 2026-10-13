# Remote WebUI & Event Hub

> Executable contracts for the Remote WebUI adapter, its auth model, and the
> multi-subscriber runtime event bus.

---

## 1. Scope / Trigger

Apply code-spec depth when a change touches:

- The HTTP/WebSocket Remote adapter (`runtime/remote/*`).
- The `RuntimeEventBus` broadcast/replay contract (`runtime/events.rs`).
- `remote_host_config` / `remote_pairing` / `remote_devices` SQLite tables.
- The transport-neutral `PiloClient` boundary (`src/lib/pilo-client.ts` + adapters).

The Remote adapter is a **transport adapter into the same Host** — it must not own
session state, and it must not call Tauri-specific types from Application code.

---

## 2. Signatures

### Tauri commands (desktop transport)

Parsed in `runtime/commands/remote.rs`; registered in `lib.rs`:

```rust
remote_host_state()                       -> RemoteHostState
remote_set_enabled(enabled: bool)         -> RemoteHostState
remote_set_port(port: u16)                -> RemoteHostState
remote_set_public_base_url(publicBaseUrl: String) -> RemoteHostState // compatibility
remote_set_addresses(addresses: Vec<RemoteAccessAddress>, entryAddressId: String) -> RemoteHostState
remote_pairing_regenerate()               -> RemoteHostState
remote_device_revoke(deviceId: String)    -> RemoteHostState
remote_device_rename(deviceId: String, name: String) -> RemoteHostState
```

`RemoteAccessAddress` (`camelCase`): `{ id: string, name: string, baseUrl: string }`.
`name` may be empty. `RemoteAccessConfig`: `{ addresses, entryAddressId }`.

`RemoteHostState` (`camelCase`): `enabled`, `running`, `port`, `baseUrl?`,
`publicBaseUrl`, `addresses[]`, `entryAddressId`, `addressConfigError?`,
`pairingUrl?`, `pairingExpiresAtMs?`, `pairingRemainingUses`, `pairingTotalUses`,
`lastError?`, `devices[]`. Desktop alone receives the active pairing URL.

### HTTP routes (`runtime/remote/api/mod.rs`)

Public:

```text
GET  /api/v1/health          -> { ok, service }
POST /api/v1/auth/pairing    -> { addresses: [{ id, name, baseUrl, issued }], expiresAtMs, remainingUses }
                              body: { secret }
POST /api/v1/auth/pair       -> { token, device }
                              body: { secret, addressId, requestId, deviceName? }
```

Authenticated (`require_auth` middleware):

```text
GET  /api/v1/bootstrap       -> { projects, chatSessions, latestSequence }
GET  /api/v1/sessions?projectId=...
GET  /api/v1/history?projectId=&sessionPath=&startMessage=&messageLimit=&includeMessageIndex=
GET  /api/v1/models?projectId=... -> ProjectModelCache | null  (Host-cached Pi model catalog)
POST /api/v1/chat/start      -> PiSessionSnapshot        body: ChatStartRequest
GET  /api/v1/chat/state?sessionKey=...
POST /api/v1/chat/rpc        -> 204                      body: { sessionKey, command }
GET  /api/v1/files/search?projectId=&query= -> string[]  (read-only @ mention search)
GET  /api/v1/files/image?projectId=&path= -> binary image bytes (project-relative, image-only)
GET  /api/v1/events          -> WebSocket upgrade
```

`fallback` serves the embedded Mobile WebUI from the Tauri asset resolver.

### WebSocket protocol

- Subprotocols: `pilo`, `pilo-token.<token>`.
- Client may pass `?after=<sequence>` for replay.
- Server frames: `{ type: "hello", deviceId, latestSequence }`,
  `{ type: "events", events: SequencedRuntimeEvent[] }`,
  `{ type: "resyncRequired", latestSequence }`.
- `SequencedRuntimeEvent` = `{ sequence, ...RuntimeEventEnvelope }` (flattened).
- Token is read from `Authorization: Bearer` **or** the `pilo-token.` subprotocol
  — never from the URL query.

### Storage (`runtime/storage/remote.rs`)

```text
remote_host_config(id=1, enabled, port, public_base_url, addresses_json NULL, entry_address_id)
remote_pairing(id=1, secret_hash, expires_at_ms, consumed_at_ms)
remote_devices(id, name, pair_ip, token_hash, created_at_ms, last_seen_at_ms, expires_at_ms, revoked_at_ms)
```

---

## 3. Contracts

- **Secrets**: pairing secret and device token are 32 random bytes, URL-safe
  base64. Only SHA-256 hashes are persisted. Plaintext never reaches the DB or logs.
- **Address configuration**: 1–32 distinct normalized HTTP(S) origins, root
  URLs only; reject credentials, query, fragment and subpath mounts. IDs are
  unique ASCII alphanumeric/hyphen strings (1–80 bytes); optional names are
  trimmed and bounded to 80 characters. Entry ID must exist in the list.
  Guarded additive columns keep `RemoteHostConfig` / `RemoteDevice` unchanged.
  `addresses_json IS NULL` projects runtime LAN plus the legacy public address,
  deduplicates origins and defaults entry to LAN. Once saved, the explicit list
  is authoritative. Invalid legacy URLs remain editable with an error but are
  excluded from pairing targets. Editing targets invalidates the old batch and
  generates a new one without clearing devices. The desktop pins the entry to the
  `lan` address when one exists and no longer exposes entry or name editing;
  legacy `name` values stay in storage but are neither edited nor shown. The
  legacy command edits only the `public` entry.
- **Port edits**: `remote_set_port` follows a saved `lan` entry only when its
  URL exactly matches the previous runtime LAN URL (or the current LAN IP with
  the old port while stopped). Custom URLs and proxy entries stay unchanged.
  Validate the resulting list before stopping; a duplicate origin rejects the
  change. Persist the port, updated LAN URL and the existing device-clearing
  policy in one transaction, then restart so links use the new target.
- **Pairing TTL / quota**: 10 minutes absolute with a fixed address snapshot and
  one slot per origin. `PairingSession` in `remote/pairing.rs` owns serialized
  exchange and in-memory receipts; `remote/access.rs` owns URL normalization.
  POSTing `/auth/pairing` only validates the secret and consumes nothing.
  Multi-address `/pair` waits for explicit selection; single-address `/pair`
  automatically exchanges for that origin before opening the workspace.
  Neither flow mounts chat connection hooks before authorization.
  No per-device automatic rotation. Exhaustion sets `consumed_at_ms` and hides
  the desktop QR; descriptions and original-proof retries remain available
  within the original TTL, but no new authorization can be issued.
- **Atomic / idempotent exchange**: `requestId` is a 32-byte CSPRNG proof encoded
  as 64 hex characters, stored in target-origin `sessionStorage` before POST.
  Never use `utils.randomId` / its `Math.random` fallback for this proof.
  The batch mutex covers an immediate SQLite transaction, device insertion,
  exhaustion update and receipt recording, all inside `spawn_blocking` with no
  await between commit and receipt. TTL is checked after acquiring the SQLite
  transaction lock, not against an earlier device creation timestamp. Failures
  roll back without losing slots. Matching secret/address/proof returns the
  same original token only while the device is valid; another proof gets 409.
  Retries do not create records or extend device expiry.
- **Pairing invalidation / ownership**: restart, stop and manual regeneration
  discard receipts and plaintext secrets, never valid device tokens. Receipts
  are bounded by address count, process-local and never Debug/logged/persisted.
  Every operation enforces TTL; a listener-owned 15 s tick also clears expired
  idle receipts. Manager serializes configuration/regeneration using its Tokio
  mutex while awaiting blocking work; HTTP only takes the batch mutex, never
  the manager mutex. Snapshot clones running references before blocking work.
- **Browser pairing lifecycle**: new links use `/pair#pair=<secret>`; selection
  links use `/pair/complete#pair=<secret>&address=<id>&entry=<entryId>`. A single
  parser accepts fragment and legacy query links, saves temporary context to
  sessionStorage and immediately replaces the URL with a clean pairing path.
  Expiry, request proof and entry ID are temporary, never stored in localStorage.
  Target pages validate origin against server metadata, reuse a valid local token
  or explicitly exchange, then save the token origin-locally. With exactly one
  configured address, selection is automatic and successful authorization replaces
  the page with `/`, without selection/completion UI. Keep origin validation,
  persisted retry proof and error/retry UI; never bypass authentication. Ordinary links
  `/` and return links `/pair` have no credentials. The same-tab selection page
  resumes from its own origin storage; closing the tab need not resume pairing.
  Foreground/retry revalidates; expiry/401 clears temporary context. `issued`
  means server issuance, not proof another origin persisted the token.
  Do not introduce popup batches, cross-origin fetch/iframes or arbitrary
  fragment return URLs. Fragment is not a substitute for HTTPS.
- **Pairing cache boundary**: both auth POST routes apply `Cache-Control:
  no-store`, including rate-limit and JSON rejection responses. No pairing
  response, full pairing URL or token may enter the PWA cache.
- **Device token TTL**: 30 days absolute. Revoked or expired tokens fail auth
  immediately; live WebSockets re-check every 15 s and on `auth_generation` change.
  Each newly paired origin gets an independent device record/token, individually
  revocable but not strictly origin-bound. Existing valid tokens survive address
  migration and restart; the pre-existing port-change clearing policy is separate.
- **Device identity**: `deviceName` is an optional, client-supplied label. The
  Remote WebUI sends `describeDevice(navigator.userAgent)`
  (`src/lib/device-name.ts`) — `机型/系统 · 浏览器` — because a raw UA is
  unreadable in the device list. New labels append the pairing address name/URL,
  using bounded portions (40 device-name + 36 address characters). `pair_ip` is the pairing request's peer IP from
  `ConnectInfo<SocketAddr>`, not client-supplied.
- **Device rename**: `remote_device_rename` reuses `auth::normalize_device_name`,
  so the same 80-char bound applies. Renaming requires the device to exist and
  not be revoked.
- **Auth scope**: authenticated == full MVP capability. No roles/capabilities yet.
- **Auth rate limiting**: only the pairing secret is IP-rate-limited (5 failures /
  60 s). Device tokens are 32 random bytes looked up by SHA-256 hash, so they are
  **not** rate-limited — blocking them turned the `401` a client needs to drop a
  stale token into an unrecoverable `429` lockout (and also gated `/auth/pair`).
- **Stale auth responses**: HTTP JSON/image helpers clear localStorage on 401
  only if its token still equals the token sent by that request. Pairing pages
  do not clear it again; the workspace error handler adopts the current stored
  token instead of discarding a newer authorization. Effect cancellation alone
  cannot prevent a late response from deleting credentials.
- **RPC allowlist**: only chat-mutating/querying commands are forwarded (see
  `ALLOWED` in `api.rs`). No generic command proxy; Terminal/Files/Git are not exposed.
- **Files surfaces**: `GET /api/v1/files/search` forwards host `fs.search` and
  returns paths only. `/files/image` is the image-only exception for Markdown
  replies (see below); generic reads, writes, and directory listing stay private.
- **Model catalog**: `GET /api/v1/models` is read-only and returns the
  Desktop-maintained `project_model_cache` snapshot (or `null` when absent).
  Remote must not spawn its own Pi probe session for the draft composer; the
  Desktop client keeps the cache fresh.
- **Attachments**: images only (`png/jpeg/webp/gif`), ≤ 10 MB each, ≤ 20 MB total,
  ≤ `MAX_CHAT_IMAGES`. Reuses the existing chat image contract.
- **Replay gap semantics**: `replay_after(seq)` returns `None` (gap → client must
  resync from snapshot) **iff** the oldest buffered sequence is greater than
  `seq + 1`. `seq == 0` always replays the whole buffer.
- **WebSocket auth expiry**: the upgrade is rejected with a plain `401` before
  the handshake, which browsers surface as an opaque `1006` close — identical to
  a network drop. `event_socket` also closes the socket when `auth_tick` (15 s)
  finds the token revoked/expired. The signal is therefore **lossy on the socket
  path**: `remote-app.tsx` re-probes `bootstrap` on every socket disconnect so the
  `401 → REMOTE_AUTH_EXPIRED → clear token → pairing screen` chain still runs.
- **Backpressure**: each Web subscriber has a bounded broadcast channel; a lagging
  subscriber receives `Lagged` and is told to `resyncRequired` instead of blocking
  the runtime. Desktop Tauri channel is another subscriber and is unaffected.
- **Browser recovery**: Remote Browser owns `online/offline` and foreground
  lifecycle recovery. `navigator.onLine` is advisory only: an already-live
  WebSocket remains authoritative, while an offline hint may slow background
  polling/retry but must not hard-disable LAN HTTP/WS access. Returning online or
  resuming after background suspension recreates the WebSocket immediately.
  Ordinary reconnects consume sequence replay and refresh bootstrap/session
  metadata; only an explicit `resyncRequired` frame may trigger full history
  resync.
- **PWA cache boundary**: the Service Worker is progressive enhancement for
  production Remote Browser on a secure context only. Tauri never registers it.
  It may precache the minimal built App Shell, but `/api/v1/**` is always
  network-only and navigation fallback always uses the canonical cached
  `index.html` (never the requested pairing URL). Web updates require explicit
  user activation rather than automatically reloading an active chat. A newly
  activated worker does not claim existing tabs; stale version caches are removed
  only after every open window in scope is controlled by the current worker.

---

## 4. Validation & Error Matrix

| Condition                                   | Result                                          |
| ------------------------------------------- | ----------------------------------------------- |
| Missing/invalid Bearer or `pilo-token`      | `401 authentication required`                   |
| Unknown/expired/revoked token               | `401 invalid or expired device token`           |
| Invalid or expired pairing secret           | `401 invalid or expired pairing link`           |
| Unknown pairing address / malformed proof   | `400` (missing old-client fields fail explicitly) |
| Slot claimed with a different request proof | `409 pairing address already used`              |
| Original receipt's device revoked/expired   | `401`; receipt cannot restore authorization     |
| SQLite insert/commit fails                  | `500`; no receipt or quota consumed             |
| Invalid access config / duplicate origin    | desktop command error; keep draft for correction |
| Too many pairing failures from one IP       | `429 too many authentication attempts`          |
| Device token revoked while WS open          | socket closed; client must re-probe for `401`   |
| RPC `type` not in allowlist                 | `400 chat command '<type>' is not available…`   |
| Non-image attachment / wrong mime / too big | `400 …` (see `validate_remote_images`)          |
| Unknown project/session                     | `404`                                           |
| Handler `Result::Err(String)`               | `400` for chat start/rpc, `500` for internal    |
| Request body over `MAX_REQUEST_BYTES`       | rejected by `DefaultBodyLimit`                  |
| Handler over 45 s                           | `408` (Tower timeout)                           |
| WS buffer lag                               | `resyncRequired`, connection kept               |

---

## 5. Good / Base / Bad Cases

- **Good**: Desktop + two Web clients observe the same session; each subscriber
  gets ordered identical sequences; a brief disconnect replays from `after`.
- **Good pairing**: scan once → selection (zero consumption) → manually open
  three origins → three independent tokens; plain bookmarks subsequently work.
  Lost response + the original proof returns exactly the original authorization.
- **Base**: Remote disabled → no listener, no port, Desktop path unchanged.
- **Bad pairing**: an unreachable target is not authenticated. Retry before TTL
  or obtain a fresh scan after expiry. Another proof cannot retrieve an issued
  token; regeneration/restart rejects all previous-batch requests, while valid
  device tokens remain usable.
- **Bad**: A Web client that stops reading must **not** stall Pi streaming; it is
  dropped to `resyncRequired` after the broadcast buffer fills.

---

## 6. Tests Required

Assertion points (inline `#[cfg(test)] mod tests`):

Existing assertions (not changed for multi-address pairing):

- `storage/remote.rs`: legacy config round-trip; test-only one-time consume helper
  expires; authenticate rejects revoked and expired devices; `pair_ip` round-trips
  and `rename_remote_device` updates only existing, non-revoked devices.
- `remote/auth.rs`: hashes are 64-char hex and never equal the plaintext;
  device names are bounded to 81 chars with `…`.
- `remote/api.rs`: `validate_remote_rpc` rejects `terminal_write`/`fs_read_file`
  and non-image attachments; `token_from_headers` reads `pilo-token.` from the
  subprotocol.
- `runtime/events.rs`: web subscribers share one ordered stream with matching
  sequences; `replay_after` reports a gap only after the buffer has evicted
  `seq + 1`; replay slice after eviction returns exactly the latest event.

---

Additional multi-address assertion points, pending explicit test authorization
(no new tests added or run during this implementation):

- Config NULL migration, explicit list persistence, duplicate-origin rejection,
  invalid legacy URL correction and address edits retaining the batch TTL.
- Saved default LAN entry follows listener port edits; custom/proxy URLs stay
  unchanged; duplicate target rejection precedes stop; port/address writes roll
  back together on failure. Device clearing on port edits remains unchanged.
- Late 401 from an old token after successful pairing preserves the new token
  for JSON and image requests and through workspace error handling.
- Concurrent same-proof exchange returns one device; different proofs cannot
  retrieve its token; DB failures roll back; TTL checked after DB lock waits.
- Last slot blocks new issuance but allows original-proof retries until expiry;
  revoke/regenerate/stop/restart cannot restore old receipt authorization.
- Multi-address `/pair` makes no exchange or chat connection; single-address scans
  automatically authorize then open `/`, including reuse of a valid local token.
  StrictMode retries use one proof,
  blocked storage fails before issuance, URLs/return/bookmarks contain no token.
- Windows desktop and actual mobile browsers: single QR entry,
  cross-origin same-tab return, offline recovery, HTTPS→HTTP top-level navigation.

---

## 7. Wrong vs Correct

#### Wrong

```rust
// Gap detection off-by-one: seq 1 with buffer starting at 2 is still contiguous.
if replay.front().is_some_and(|first| first.sequence > sequence) {
    return None;
}
// Tests that send only CAPACITY + 1 events never create a real gap.
```

#### Correct

```rust
if sequence > 0
    && replay
        .front()
        .is_some_and(|first| first.sequence > sequence.saturating_add(1))
{
    return None;
}
// Evict at least two events (CAPACITY + 2 sends) before asserting a gap for seq 1.
```

```rust
// Tauri commands expose their arguments flat; many-arg commands are expected.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // flat IPC argument surface
pub async fn chat_session_start(/* … 8 params … */) { … }
```

---

#### Wrong: consuming before persisting a device

```rust
consume_remote_pairing(&mut db, hash, now)?;
insert_remote_device(&db, &device, token_hash)?; // failure loses authorization
```

#### Correct: atomic issuance and proof-gated receipts

```text
batch mutex → immediate transaction → validate hash/TTL/unconsumed
→ insert device + mark exhausted if last slot → commit
→ record original token + request proof hash before any await
retry → verify original proof AND unrevoked/unexpired device → same response
```

Do not return a receipt based on only the reusable secret + address ID.

---

## Design Decisions

- **No daemon / no new crate (Phase 1).** Axum + Tower-HTTP live inside
  `src-tauri`; Application logic is `runtime/chat_service.rs`, not a God service.
- **Manager owns the listener.** `RemoteServerManager` is the single place that
  starts/stops the listener, persists `enabled`, and restores on app start.
  Remote OFF means the listener does not exist.
- **EventHub over EventBus.** `RuntimeEventBus` keeps the Tauri `Channel`
  subscriber and adds a bounded `broadcast` sender plus a bounded replay deque;
  replay/sequence live in the adapter layer, never in the Pi runtime.
- **Transport-neutral client.** `PiloClient` is implemented by `TauriPiloClient`
  (invoke/channel) and `WebPiloClient` (fetch/WebSocket); only Remote-MVP features
  are migrated — generic Files/Terminal/Git stay Tauri-only. Project image reads
  are shared through `PiloClient.readProjectImage`.

## Project Images in Markdown Replies

### 1. Scope / Trigger

Apply when changing Markdown image rendering, project image transport, or its
security boundary. This uses plain Pi reply text; it does not extend Pi RPC.

### 2. Signatures

- `project_fs_read_image(id: String, path: String) -> Result<Vec<u8>, String>`
- Authenticated `GET /api/v1/files/image?projectId=&path=` -> binary bytes
- `PiloClient.readProjectImage(projectId, path) -> Promise<Uint8Array<ArrayBuffer>>`
- `remote_fs::read_image(servers, project, path)` owns both transport validations.

### 3. Contracts

- `![caption](./screenshots/page.png)` resolves relative to the original project
  in its connection environment, not the browser origin or the Pi session file.
- Frontend decodes URL escaping once and normalizes separators. Backend accepts
  relative paths only; rejects parent components, control characters and URL syntax.
- PNG/JPEG/WebP/GIF only, regular files only, at most 10 MB. Check metadata before
  reading and length/signature afterward. Server canonicalization prevents symlink
  escapes; no generic filesystem API is exposed to WebUI.
- HTTP uses Bearer auth and returns `application/octet-stream`, `no-store`,
  `nosniff`. Tokens must never appear in Markdown, image URLs or query parameters.
- Desktop and WebUI inject project scope into the shared Markdown image component,
  including temporary chats. Project reads deduplicate only in flight by project +
  session + path; new references reread live files instead of reusing completed
  reads. Each resolved Blob has its own entry in the bounded URL LRU, so rereading
  a path does not revoke an earlier reply's URL. History images still reuse URLs
  keyed by session fingerprint.
- Blob images offer Save image. HTTP(S) images offer Open original image (new tab)
  with `target="_blank"` and `rel="noopener noreferrer"`, not `download`: browsers
  ignore that attribute on ordinary cross-origin URLs and otherwise navigate away.
- `MARKDOWN_REHYPE_PLUGINS` keeps raw/sanitize/harden protections. Between sanitize
  and harden, `rehypeProjectImages` preserves non-external `src` in the internal
  `data-pilo-image-src` prop and replaces it with a non-fetchable-by-our-component
  sentinel. The custom image component validates the preserved path. Do not rely
  on harden's rewritten URL: it rebases `./` and silently consumes `../`.
- Images reference live project files, not historical snapshots. No automatic
  prompt injection, screenshot capture, Pi extension or duplicate session store.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Invalid/revoked token | Existing 401 auth handling |
| Unknown project | HTTP 404 |
| Absolute/traversal path, unsupported type, non-regular file, >10 MB, signature mismatch | Command error / HTTP 400, no image bytes returned |
| Missing file / image decode failure | Inline failure with retry |
| No project scope / invalid Markdown source | Unavailable placeholder; never fetch a browser-relative path |

### 5. Good / Base / Bad Cases

- Good: a project screenshot is interleaved with reply text, previewable and savable.
- Base: HTTP(S) images and user/tool image display remain supported.
- Bad: `../private.png`, `/tmp/a.png`, `file://`, data URLs or SVG must not read files.

### 6. Tests Required

- `tests/chat-markdown-images.test.ts`: path decoding/rejection, real Markdown
  plugin order, surrounding text, HTTPS images, in-flight deduplication, rereading
  overwritten files without revoking previous URLs, bounded URL retention, retry
  and history cache regression.
- `remote_fs::tests`: extension/path, matching signatures and post-read size cap.
- Existing server filesystem tests: canonical paths and symlink escape rejection.
- `/tests/chat-markdown-images.html` under Vite: require body
  `data-test-status="passed"`; checks desktop/mobile layout, inline images,
  lightbox/save actions, retry, overwritten screenshots in new replies, external
  action label/target/no-download and no unsafe reader calls. Reader is injected;
  this does not replace Windows desktop and real Local/WSL/SSH end-to-end checks.

### 7. Wrong vs Correct

- Wrong: render a relative `<img src>` directly, infer safety from harden's rebased
  URL, use unauthenticated file URLs, or serve arbitrary project bytes to WebUI.
- Correct: preserve and validate the original source, use the image-only scoped
  host read, and display Blob URLs through the shared preview component.
