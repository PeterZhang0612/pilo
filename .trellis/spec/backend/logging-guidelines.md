# Logging Guidelines

Pilo uses `tauri-plugin-log` for desktop log persistence. Rust code logs through
`log` macros; the plugin writes the desktop log file and handles bounded
rotation.

## Configuration

`src-tauri/src/lib.rs` registers the log plugin before `setup` with:

- `Debug` level for debug builds and `Info` for release builds;
- the default Tauri log directory (`app_log_dir()`), with a 5 MB file limit;
- `RotationStrategy::KeepSome(4)`, giving up to four archived 5 MiB files plus the active file (about 25 MiB total);
- the `Webview` target so Rust log entries remain visible in DevTools through
  the frontend `attachLogger()` bridge.

The frontend registers one `attachLogger()` listener from `src/main.tsx` and
replays backend records through the original browser console methods. It bridges
only `console.error` and `console.warn` to the plugin's `error` and `warn` APIs.
`console.log` and other hot-path console output are not persisted. The Rust
`Webview` target filters records whose target starts with `WEBVIEW_TARGET`, so
frontend-originated records are persisted to the log file without being echoed
back into the webview.

The About settings page opens the same directory with `appLogDir()` and the
`opener` plugin. Scope `opener:allow-open-path` to `$APPLOG`; the bare command
permission exposes the command but still rejects the path. Do not duplicate the
path calculation in Rust or TypeScript.

## Rust conventions

Use the `log` facade and keep the subsystem tag as the `target`:

```rust
log::error!(target: "window-state", "failed to restore main window: {error}");
log::warn!(target: "pilo-server", "[{label}] {message}");
```

- Tag matches the owning module/feature, not the file path:
  `window-state`, `server-prewarm`, `notification`, `runtime-events`, or
  `pilo-server`.
- Log at boundaries where an error is swallowed (background task, event send,
  or best-effort side effect). If an error propagates to the frontend, do not
  duplicate its raw message. Correlated runtime diagnostic metadata is an
  intentional exception: each transport boundary may record its own stage.
- Do not add per-message logs on hot paths (streaming, virtualization, session
  parsing). Bounded lifecycle/RPC summaries are allowed as described below.
- `crates/pilo-server` stdout is a protocol channel: only `--version` /
  fingerprint subcommands may print there. Service diagnostics stay on stderr;
  `src-tauri/src/runtime/server_client.rs` routes that stderr into the desktop
  logger.

## What to log

- Startup and teardown failures that would otherwise be silent.
- Background task failures (session watcher, server prewarm, notification send).
- Environment probes when they aid support.
- Frontend errors and warnings that are already reported through `console`.

## What not to log

- Secrets, credentials, SSH passwords, keyring values, or access tokens.
- Full conversation/JSONL content.
- Anything in a tight loop.
- Raw objects when a concise error message is sufficient.

When adding a new diagnostic boundary, prefer one descriptive message and keep
user-facing command errors separate from diagnostic logs.

## Runtime Timeout Diagnostics

### 1. Scope / Trigger

Use for startup/RPC timeouts, shared server failures, and stalled Desktop/WebUI
streams. Keep timeout, retry, teardown, and public error behavior unchanged.

### 2. Signatures

- `runtime_trace(stage, session_key, stream_id, detail)` keeps the existing debug
  JSONL trace and emits selected metadata to the rotated desktop log in release.
- `debug_runtime_trace_log(payload)` accepts frontend trace JSON in all builds.
  `append_frontend_trace` uses the same metadata allowlist; it is not a generic
  release logger for arbitrary frontend objects.

### 3. Contracts

- `runtime-diagnostics` records include desktop PID, source, stage, session key,
  stream ID, and allowlisted scalar metadata. Never persist `error`, `message`,
  command bodies, tool arguments/results, or authentication objects here.
- Correlate `webview.rpc.begin/end`, `chat.send.*`, `server_pi.recv` responses,
  `channel.send`, and `webview.recv` by the Pi RPC `id`. Initialization uses
  `chat.control.begin/sent/end`, with `timeoutMs`, `elapsedMs`, and `timedOut`.
- Session mutex acquisition records `lockWaitMs`; client transport summaries
  record envelope `requestId`, method, RPC ID, elapsed/enqueue time, queue capacity,
  and pending request count on timeout. `launcherPid` is the Windows/SSH launcher
  child, not necessarily the environment's actual server PID.
- `channel.send` includes Channel ID, runtime replay `sequence` and serialized
  `payloadBytes`; frontend receipt also records its Channel ID. This sequence
  is **not** the Tauri Channel's internal message index.
- Persist process state, RPC response, runtime error code and final assistant
  completion metadata, not text/thinking deltas or tool update events.
- Desktop timeout warnings include `sendCompleted`, `responseReceived`, channel
  ID, received event count, last-event age/type and last session event type.
  Receipt without successful command transport can still time out; log both flags.
- Server diagnostics go to stderr only: actual PID/version, Pi child lifecycle,
  write timeout/I/O kind, request capacity exhaustion/admission delay, task
  panic/cancellation, failed or >=5-second requests, stdout/stdin closure and
  cleanup. Desktop captures this stderr in the existing `pilo-server` target.
- WebUI browser timeout warnings include RPC/session IDs, elapsed time, command
  transport completion, pending count and last socket sequence/message age.
  These warnings stay in the browser console; shared Host stages and socket
  open/close/replay-gap/lag/send errors are persisted in the desktop log.

### 4. Validation & Error Matrix

- Missing RPC reply -> timeout metadata; preserve the existing caller error.
- Transport loss -> pending count and affected stream count plus I/O reason.
- Stream overflow -> stream ID, event size and remaining queue/byte capacity.
- Web replay gap/lag -> device ID and sequence context; no token or event body.
- Normal deltas/tool updates -> no release per-event diagnostic log.

### 5. Good / Base / Bad Cases

- Good: response received by Host and sent to a window, but absent from
  `webview.recv`, identifies the Desktop delivery boundary as suspect.
- Base: a single Pi initialization times out while other sessions keep delivering.
- Bad: infer that a caller timeout itself killed all sessions, or log raw RPC data.

### 6. Coverage When Requested

Assert allowlisting drops body/error/auth fields, release logs preserve matching
RPC IDs, timeout flags distinguish transport and response completion, and normal
streaming produces no per-delta records. Exercise Desktop and WebUI separately;
WebUI console warnings are not automatically forwarded to the Host log.

### 7. Wrong vs Correct

- Wrong: promote every debug trace or dump `RuntimeEvent`/command JSON to release.
- Correct: reuse the shared stage filter and scalar allowlist, recording only
  boundary metadata while retaining existing log rotation limits.
