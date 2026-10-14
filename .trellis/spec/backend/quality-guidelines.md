# Backend Quality Guidelines

> Rust review standards and validation commands.

---

## Validation Commands

Run from the repo root:

```bash
cargo fmt --all --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
```

`clippy -D warnings` means a warning fails the check. Fix warnings, don't silence
them (`#[allow(...)]` only with a comment explaining why).

## Code Standards

- **Edition 2024**, `resolver = "2"` workspace.
- Prefer `pub(crate)` over `pub`. Only `domain/*` and command functions need
  wider visibility.
- Async commands use `#[tauri::command] pub async fn`; sync ones stay sync.
  Don't make a command async if it only touches SQLite.
- Use `State<'_, PiloRuntime>` for shared runtime access;
  `AppHandle` for storage/app-dir access.
- Process/IO work is `tokio`-based (`fs`, `io-util`, `process`, `sync`, `time`).
- Serde types exposed to the frontend use `#[serde(rename_all = "camelCase")]`
  (see `src-tauri/src/runtime/session_history/types.rs`). Wire fields that must
  keep their name use an explicit `#[serde(rename = "...")]`.
- Keep `domain/` types plain data; no `Mutex`, no side effects.

## Testing

- Unit tests live inline under `#[cfg(test)] mod tests` in the module they cover
  (e.g. `storage.rs`, `session_history/tests.rs`, `pilo-server/src/tests.rs`).
- Integration tests: `crates/pilo-server/tests/stdio_protocol.rs`.
- Pure logic tests: `#[test]`; anything touching async runtime: `#[tokio::test]`.
- Storage tests use in-memory SQLite, never the real app DB.
- Prefer small focused tests over broad integration suites.

## Forbidden Patterns

- `.unwrap()` / `.expect()` outside tests and truly infallible cases.
- `unsafe`.
- String interpolation into SQL.
- Adding `anyhow`/`tracing`/new dependencies just for ergonomics — the stack is
  deliberately small.
- Panicking in a `#[tauri::command]` (poisons the IPC response).
- Blocking the async runtime with synchronous long-running work; use
  `spawn_blocking` / a background thread.

## Platform Notes

- macOS/Windows-only code is gated with `#[cfg(target_os = ...)]` and
  platform dependencies live under `[target.'cfg(...)'.dependencies]` in
  `src-tauri/Cargo.toml`.
- `pnpm tauri dev` and desktop-window/installer verification must run on Windows.
  WSL is for code, `cargo check`, and static validation only.

### Bundled server resource paths

- Initialize the server resource directory from `app.path().resource_dir()` in
  Tauri setup, before restoring connections or starting server prewarming.
- `server_binary` checks explicit `PILO_SERVER_PATH` / `PILO_SERVER_LINUX_PATH`
  overrides first, then `<resource_dir>/runtime/<resource_name>`, portable/macOS
  fallback locations, and staged development resources. Missing files keep the
  existing `bundled pilo-server runtime ... is missing` error.
- Linux resource directories use Tauri's product name, not the executable stem:
  the deb installs `/usr/bin/pilo` with resources under `/usr/lib/Pilo/runtime`.
  AppImage resources live under its mount directory. Do not lowercase the
  product name or infer `/usr/lib/pilo` from the executable.
- Regression coverage must include the case-sensitive deb/rpm layout and the
  AppImage mount layout, alongside Windows portable and macOS bundle paths.
