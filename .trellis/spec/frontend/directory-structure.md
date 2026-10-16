# Frontend Directory Structure

> How the React app under `src/` is organized.

---

## Layout

```
src/
  main.tsx          # React root, providers, root error boundary
  App.tsx           # App shell: layout, panels, lazy feature mounting
  index.css         # Tailwind entry + design tokens
  ui/               # shadcn/ui-style primitives (barrel: ui/index.ts)
  components/       # feature components, one folder per feature
  lib/              # non-React logic, API clients, providers, hooks
  remote/           # Mobile WebUI shell (browser transport)
  assets/
```

## `src/ui/`

Primitive, reusable building blocks (Button, Dialog, Select, Tooltip, …).
They are generic, prop-driven, and must not import feature code.

- Every primitive is re-exported from `src/ui/index.ts`. Import via
  `import { Button } from "@/ui"` — do not deep-import unless you need a
  non-barrel export.
- Add a new primitive here only if it is genuinely cross-feature.

## `src/components/<feature>/`

Feature UI lives in a kebab-case folder:

- `chat/` — the conversation surface (largest feature).
- `sidebar/` — project/session navigation.
- `settings/` — settings dialog sections.
- `app/` — app-shell orchestration hooks that wire features together.

Files are kebab-case, one component/hook per file, `export function Xxx`.
Co-located helpers (`chat-page-utils.ts`, `chat-expansion-state.tsx`) stay in
the feature folder.

## `src/lib/`

Shared logic and thin glue, with kebab-case file names:

```text
src/lib/
  api/       # domain clients, runtime transport/types, desktop window API
  chat/      # conversation state, submissions, search, media, rendering helpers
  *.ts       # cross-feature utilities and settings models
  *.tsx      # shared preferences/theme providers
  use-*.ts   # cross-cutting hooks
```

- **Domain clients** live in `api/`: `sessions.ts`, `connections.ts`,
  `projects.ts`, `terminal.ts`, `git.ts`, `preview.ts`, etc. They expose typed
  async functions over Tauri or Pi RPC. Their associated transport types stay
  beside them (`api/pi-runtime-types.ts`).
- **Transport-neutral client**: `api/pilo-client.ts` defines `PiloClient`;
  `api/tauri-pilo-client.ts` implements it over invoke/channel and
  `src/remote/web-pilo-client.ts` over fetch/WebSocket. Shared feature code
  depends on `PiloClient`, not on either implementation directly.
- **Remote transport**: `api/remote.ts` + `src/remote/remote-client.ts` hold
  Remote HTTP/WS calls and token storage; `src/remote/remote-app.tsx` is the
  browser shell. Browser-only modules must not gain a runtime dependency on a
  desktop adapter during a move.
- **Chat logic** lives in `chat/`: reducers, replay, submission/mention parsing,
  streaming presentation, image handling and opt-in diagnostics. This folder
  also contains chat-specific adapters; it is not a pure-logic-only boundary.
- **Cross-feature utilities, settings, providers and hooks** stay at the root.
  Component-specific helpers stay beside their components instead of moving
  into `lib/` just because they are testable.
- Import modules directly; do not add compatibility re-export files or a new
  barrel solely to hide a directory move.

## `tests/`

- `unit/`: focused logic, state/store and static-rendering tests.
- `integration/`: CLI/process and Pi extension integration tests.
- `browser/`: HTML regression pages served through Vite.
- `packaging/`: platform packaging/orchestration tests.
- `helpers/`: shared test tooling, including the Node TSX/alias loader.

See `tests/README.md` for commands. New Node tests are discovered by directory
and file name; do not maintain a per-file list in `package.json`.

## Rules

- React code never calls `@tauri-apps/api` directly — go through `src/lib/*`
  (or the `PiloClient` adapter).
- UI components don't contain raw Tauri calls; hooks/`lib` do.
- Browser-only code must not import Tauri APIs at module top level; the Remote
  shell is loaded based on `__TAURI_INTERNALS__` detection in `main.tsx`.
- New feature → new folder under `components/`, new API module under `lib/api/`
  if it talks to the backend. Chat-domain shared helpers go in `lib/chat/`.
- Prefer `@/` path alias (maps to `src/`) over deep relative imports.
