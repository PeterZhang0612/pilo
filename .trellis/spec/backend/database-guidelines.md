# Database Guidelines

> SQLite conventions. Pi session data is a **desktop index/cache**, never the
> conversation source of truth. Pilo-owned preferences may use SQLite as their
> authoritative store.

---

## Overview

- Engine: `rusqlite` (bundled SQLite), no ORM, no query builder.
- DB file: `pilo.sqlite3` in Tauri `app_data_dir()`.
- Opened through `storage::open(&app)` (`src-tauri/src/runtime/storage/schema.rs`).
- `pnpm tauri dev` (also used by `pnpm dev`) automatically merges
  `src-tauri/tauri.dev.conf.json` through `scripts/tauri.mjs`. Development uses
  `app.hsingjui.pilo.dev`; release retains `app.hsingjui.pilo`. Keep their app
  data, logs and WebView storage separate: a development schema migration can
  make the shared database incompatible with an older installed release.
  Direct `pnpm exec tauri dev` / `cargo tauri dev` bypass the wrapper and must
  explicitly pass `--config src-tauri/tauri.dev.conf.json`. Pi JSONL remains
  shared; never copy or delete the release database to initialize dev.
- The Pi JSONL files are the single source of truth; SQLite only indexes/caches
  (`sessions`, `project_model_cache`, `session_ui_state`, …). Never copy full
  conversation data into the DB.
- Pilo-owned project Scope lives separately in `project_model_scopes`, not in Pi
  settings or `project_model_cache`; see [Project Model Scope](./project-model-scope.md).

## Connection Setup

`storage::open` is the only entry point. It sets:

```rust
connection.busy_timeout(Duration::from_secs(2))?;
connection.execute_batch("PRAGMA foreign_keys = ON;")?;
```

Schema init is memoized per DB path via `INITIALIZED_DATABASES: OnceLock<Mutex<HashSet<PathBuf>>>`.

## Schema & Migrations

There is no migration framework. The pattern is **idempotent DDL plus guarded column adds**:

1. `initialize_schema` runs `CREATE TABLE IF NOT EXISTS ...` and
   `CREATE INDEX IF NOT EXISTS ...` for every table.
2. New columns are added with a helper that checks `pragma_table_info`
   before `ALTER TABLE`:

```rust
fn ensure_connection_columns(db: &SqliteConnection) -> Result<(), String> {
    let has_pi_executable = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('connections') WHERE name='pi_executable')",
        [], |row| row.get::<_, i64>(0),
    ).map(|exists| exists != 0).map_err(|error| error.to_string())?;
    if !has_pi_executable {
        db.execute_batch("ALTER TABLE connections ADD COLUMN pi_executable TEXT; ...")?;
    }
    Ok(())
}
```

3. Cross-cutting renames are handled by an explicit legacy migration
   (`migrate_legacy_workspaces_schema`) so old DBs upgrade in place.

## Naming Conventions

- Tables and columns: `snake_case`.
- JSON blobs: `<name>_json` (e.g. `kind_json`, `metadata_json`).
- Millisecond timestamps: `<name>_ms` (`updated_at_ms`, `last_opened_at_ms`).
- ISO-8601 text timestamps (Pi-sourced): `created_at`, `updated_at`.
- Row IDs are text, not autoincrement: `project:<connection>:<path>` style.

## Query Patterns

- Named/positional `params![]` macros, never string interpolation in SQL.
- Store modules expose small typed functions (`list_projects`, `upsert_project`,
  `get_connection`, `ensure_local_connection`) — callers never write SQL.
- `INSERT ... ON CONFLICT ... DO UPDATE` for upserts.
- `upsert_project` deliberately does **not** overwrite the connection
  configuration — a project row references the live connection. Keep that invariant.

## Project-Scoped Session Identity

### Scope / Trigger

Local, WSL and SSH connections can contain identical session paths and Pi IDs.
Project identity must survive storage, IPC, sidebar actions and unread tracking.

### Signatures

- `sessions` and `session_ui_state`: `PRIMARY KEY(project_id, session_path)`.
- `session_update_ui_state`: `{ sessionPath, update, projectId?: string }`
  returns `SessionIndexEntry`.
- Sidebar select/delete callbacks take `(sessionId, projectId)`; rename also
  carries `projectId`. Do not change the Pi session ID itself.

### Contracts

`ensure_session_project_keys` rebuilds legacy path-only tables in an immediate
transaction. It copies indexed rows and joins UI preferences to their indexed
owner before replacing tables and indexes. Legacy UI rows without an indexed
owner cannot be assigned safely and are not migrated. Pi JSONL is unchanged.
All joins, upserts and deletions use project plus path. UI lookup, selection,
React keys and unread state use project plus Pi ID.

`get_session` resolves an omitted project only for legacy callers, rejecting
multiple owners before reading the row. Scoped reads use direct equality on
both `project_id` and `session_path`; do not hide the project predicate behind
`? IS NULL OR ...`, which prevents direct use of the composite primary key.

### Validation & Errors

- Explicit project and indexed path: update only that project's row.
- Omitted project, unique indexed path: accept for old IPC callers.
- Omitted project, multiple owners: reject with
  `session path is ambiguous; projectId is required`.
- Missing indexed row: reject as not indexed; never create unowned preferences.
- Failed migration: transaction rolls back; schema initialization fails.

### Good / Base / Bad Cases

- Good: two projects share a path; renaming or deleting one leaves the other intact.
- Base: a legacy database upgrades and preserves preferences of indexed sessions.
- Bad: selecting the first row matching only `sessionPath` or `piSessionId`.

### Required Regression Checks

When verification is authorized, cover legacy migration and repeated init,
colliding paths across projects, scoped delete/rename, ambiguous legacy IPC,
and desktop/WebUI selection and unread isolation. Migration cannot reconstruct
rows or preferences already overwritten by the old global path key.

Installed and development builds share `app_data_dir()` when their Tauri
identifier is the same. After the scoped-key migration, an older binary still
using `ON CONFLICT(session_path)` fails with `ON CONFLICT clause does not match
any PRIMARY KEY or UNIQUE constraint`. Check running executable paths and the
actual table/index definitions before changing migrations. Do not restore global
path uniqueness to accommodate an old process; stop using the incompatible build.

### Wrong vs Correct

Wrong: `DELETE FROM sessions WHERE session_path=?1`.
Correct: `DELETE FROM sessions WHERE project_id=?1 AND session_path=?2`.

## Shared Session Read Progress

### 1. Scope / Trigger

Desktop windows and Remote WebUI share Host-owned read progress. Apply this
contract when changing unread tracking, completion events or read-state APIs.

### 2. Signatures

- `session_read_states() -> SessionReadState[]`
- `session_mark_read(projectId, sessionPath, revision) -> SessionReadState`
- Authenticated `GET /api/v1/sessions/read-state` returns the same list; `POST`
  accepts `{ projectId, sessionPath, revision }` and returns one state.
- State: `{ projectId, sessionPath, completedRevision, readRevision }`.
- `session_read_state`: composite key `(project_id, session_path)`, project FK
  with cascading deletion, completed/read revisions. It does not require an
  indexed session: a new Pi chat may settle before indexing finishes.
- `session_read_revision`: one durable counter, allocated in the same immediate
  transaction as completion. Do not reset it when deleting sessions/projects.

### 3. Contracts

`ChatEventSink` records an active turn's `AssistantMessageEnd`, not process exit
or runtime failure. Desktop/WebUI external-activity polls share serialized
per-project observation: known open -> explicitly idle records completion;
a disappeared process does not. Unobserved external turns cannot be inferred.
SQLite runs in blocking workers, never on the Pi event stream's executor.

At completion, immediately broadcast global `session_turn_completed {
projectId, sessionPath, completionId }`. Its opaque random ID identifies the exact
turn, not a persisted revision. A single blocking worker preserves turn order
within each session, coalesces queued turns to the latest completion per session,
and broadcasts `session_read_state_changed { state, completionId }` after commit.
Ordinary read acknowledgements omit `completionId`. Both events
have no Pi generation and must bypass conversation/RPC reducers. Desktop uses
the existing global channel; WebUI consumes its existing socket rather than
creating another socket.

Read acknowledgement is monotonic and bounded by the supplied observed revision:
`read_revision = MAX(read_revision, MIN(requested, completed_revision))`. The
shared hook merges each revision by maximum to tolerate snapshot/replay/HTTP
reordering. Full snapshots remove absent records, except live updates received
after that snapshot request started. Discard superseded snapshot responses so
an older request cannot restore deleted records. Refresh on initialization,
foreground and WebUI recovery; `refreshKey` is an explicit effect generation.
Only the visible, focused client's selected session observes completion IDs.
Retain these observations across navigation/focus changes, then acknowledge only
the matching committed revision. Bound pending observations to 512 IDs if storage
repeatedly fails. Already committed selected sessions are acknowledged normally.
Selection itself is not synchronized. New completion revisions remain unread
until seen.
Sessions without a Host record retain legacy local tracking (including temporary
chats). Existing historical turns are not retroactively marked unread.

### 4. Validation & Error Matrix

- Zero, negative, fractional or unsafe JS revision: reject; never clear a turn.
- Unknown project/path record: reject acknowledgement; never create a record.
- DB failure: report failure, do not broadcast an acknowledgement.
- Old acknowledgement after a newer completion: newer completion stays unread.
- Session deletion: remove its scoped read state; project deletion cascades.

### 5. Good / Base / Bad Cases

- Good: open a completed Host chat on WebUI; every desktop window clears its dot.
- Base: restart/refresh loads persisted progress; temporary chats remain local.
- Bad: an old HTTP reply or replay must not restore a cleared dot or read a new turn.

### 6. Required Verification (When Authorized)

Cover both read directions, two desktop windows, refresh/restart, foreground and
reconnect, hidden clients, acknowledgement racing a new completion, reversed
snapshot/event delivery, completion observed before a delayed commit followed
by navigation/blur, consecutive completions racing acknowledgement, overlapping
snapshots and deletion with a live event in flight, colliding project paths,
delete/recreate revision allocation, external open/idle/disappearance and SQLite
failure. No historical
conversation payload is copied into read-state storage.

### 7. Wrong vs Correct

Wrong: persist a boolean, use Pi process generation as a turn ID, or synchronize
which session is selected. Correct: persist Host-issued completion/read revisions
and acknowledge only the revision actually observed by the focused client.

## Shared Theme Settings

### 1. Scope / Trigger

Host-owned appearance shared by desktop windows and authenticated WebUI.

### 2. Signatures

- SQLite `theme_settings(id INTEGER PRIMARY KEY CHECK(id = 1), settings_json TEXT)`.
- `theme_settings_get(initial?: ThemeSettings) -> ThemeSettings` (desktop IPC).
- `theme_settings_set(update: ThemeSettingsUpdate) -> ThemeSettings` (desktop IPC).
- Authenticated `GET /api/v1/theme -> ThemeSettings` and `POST /api/v1/theme`
  with a `ThemeSettingsUpdate` body -> committed `ThemeSettings`.
- `PiloClient.loadThemeSettings()` / `saveThemeSettings(update)` expose the same
  snapshot and patch transport contracts. The authenticated HTTP write endpoint
  remains available, but WebUI has no theme editing UI and does not call it.
- Global `theme_settings_changed { settings }` uses the existing runtime bus.
- Settings: `{ revision, theme, themeFamily, themeCustomCss, themeCustomName,
  savedCustomThemes: [{ name, css }] }`. Mode is light/dark/system; family is
  lody/claude/custom. Updates contain optional mode/family/CSS/name fields plus
  `saveCustomTheme: { name, css }` or `deleteCustomTheme: string`.

### 3. Contracts

Initialize with idempotent DDL. Only desktop supplies legacy initial settings;
insert revision 1 with `ON CONFLICT DO NOTHING`, never replace an existing row.
A Web read before initialization returns defaults at revision 0 without inserting.
Patches read/merge/write in an immediate transaction, increment revision and
broadcast only after commit. Save/delete actions merge against the persisted
custom-theme list, not a stale window snapshot. Saving trims/requires a name,
replaces an exact-name saved theme and sets active CSS/name. Deleting preserves
active CSS, matching existing behavior. SQLite runs in blocking workers.
Clients discard equal/older revisions; startup caches are never authoritative.
Desktop serializes its writes and applies responses only after persistence
succeeds. Selecting a saved theme patches family, CSS and name in one request,
not separate writes. `AppearanceSettings` is desktop-only; WebUI has no theme
settings entry, editor or switching controls in either wide or mobile layouts.
WebUI follows the Host through authenticated snapshot reads and existing global
theme events, with refresh on initialization, reconnect/resync and foreground.
Clean desktop CSS/name drafts follow other windows' changes; unsaved local drafts
are preserved. Global theme events bypass conversation reducers. Font settings
remain local.

### 4. Validation & Error Matrix

- Unknown mode/family/update fields: reject at serde decoding.
- Blank saved-theme name: error, transaction rolls back.
- Load failure: IPC error or HTTP 500. Save failure: IPC error or HTTP 400
  (the existing remote settings-write convention); no change event for a failed write.
- Missing/expired Web token: existing authenticated-route 401 handling.

### 5. Good / Base / Bad Cases

- Good: desktop switches a built-in/custom theme; other desktop windows and
  connected wide/mobile WebUI clients follow without WebUI editing controls.
- Base: restart/refresh reads SQLite; legacy desktop themes migrate once.
- Bad: stale browser settings overwrite an existing row, or an old HTTP/event
  snapshot reverts a newer revision.

### 6. Tests Required

Pending explicit authorization (no tests added/run): migration idempotency and
legacy theme retention; restart persistence; concurrent field patches and
save/delete merges; unknown enums and blank-name rollback; failed commit emits
nothing; snapshot/replay reordering; reconnect/foreground recovery; custom CSS
removal on family change; desktop edits synchronizing to other desktop windows,
wide WebUI and mobile WebUI; no WebUI theme editing/switching controls;
authenticated-only writes; atomic saved-theme selection; clean desktop draft
synchronization and dirty draft preservation.

### 7. Wrong vs Correct

Wrong: synchronize theme via browser `storage` events or persist fonts with it.
Correct: SQLite theme patches -> committed revision -> existing desktop/Web event
channel, with authenticated snapshot reads for recovery.

## Testing

Storage unit tests live in `src-tauri/src/runtime/storage.rs` under `#[cfg(test)]`
and use `SqliteConnection::open_in_memory()`. Add an in-memory test for every
new storage function.
