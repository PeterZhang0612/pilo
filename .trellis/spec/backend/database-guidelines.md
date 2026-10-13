# Database Guidelines

> SQLite conventions. Pi session data is a **desktop index/cache**, never the
> conversation source of truth. Pilo-owned preferences may use SQLite as their
> authoritative store.

---

## Overview

- Engine: `rusqlite` (bundled SQLite), no ORM, no query builder.
- DB file: `pilo.sqlite3` in Tauri `app_data_dir()`.
- Opened through `storage::open(&app)` (`src-tauri/src/runtime/storage/schema.rs`).
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

### Wrong vs Correct

Wrong: `DELETE FROM sessions WHERE session_path=?1`.
Correct: `DELETE FROM sessions WHERE project_id=?1 AND session_path=?2`.

## Testing

Storage unit tests live in `src-tauri/src/runtime/storage.rs` under `#[cfg(test)]`
and use `SqliteConnection::open_in_memory()`. Add an in-memory test for every
new storage function.
