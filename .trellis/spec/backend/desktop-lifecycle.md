# Desktop Startup and Tray Lifecycle

## 1. Scope / Trigger

Desktop-only login startup, tray menus/icons, global window activation,
main/session window visibility and application exit. These are Host OS controls, not Remote WebUI endpoints. Closing
a browser tab does not hide or terminate the desktop Host.

## 2. Signatures

- `desktop_autostart_get() -> AutostartMode`
- `desktop_autostart_set({ mode: AutostartMode }) -> AutostartMode`
- `AutostartMode = "disabled" | "window" | "tray"` (Serde camelCase).
- `desktop_tray_set_labels({ labels: { show, hide, quit } }) -> ()` updates the
  native menu from the main WebView's initialized i18n and language changes.
- `desktop_settings(id INTEGER PRIMARY KEY CHECK(id = 1), autostart_mode TEXT,
  show_shortcut TEXT)` stores the JSON-encoded startup mode and a normalized
  shortcut string. Missing mode means disabled; missing/NULL shortcut defaults
  to `mod+alt+p`. Add the nullable column with a guarded migration. Writes to
  either field must preserve the other.
- `desktop_window::show_main`, `hide_to_tray`, `sync_dock_visibility` own native
  visibility; `desktop_tray::handle_window_event` intercepts main close only.
- `desktop_shortcut::install(&AppHandle) -> Result<(), String>` registers the
  native show shortcut; `registered_label(&AppHandle) -> Option<String>` gates
  its tray hint.
- `desktop_shortcut_get() -> { shortcut: string, registered: boolean }`
- `desktop_shortcut_set({ shortcut: string }) -> { shortcut, registered: true }`
  returns only after registration and persistence succeed.

## 3. Contracts

- Register the single-instance plugin first. Manual second launches restore the
  existing main window; second launches carrying `--autostart` do not steal focus.
- Register login startup through the official autostart plugin, always passing
  `--autostart`. Only that argument plus saved `tray` mode plus successful tray
  creation permits a hidden startup. Normal manual launches always show the UI.
- OS registration is authoritative for whether startup is enabled. If disabled
  outside Pilo, reads return disabled without re-enabling it. An enabled OS entry
  with no enabled saved mode projects as `window`.
- Save under an immediate SQLite transaction; OS registration failure rolls back
  the preference. If commit fails after registration, attempt to restore the
  previous enabled state and log any compensation failure. Skip deleting an
  already-absent startup entry (older Windows plugin lines report NotFound).
- Autostart names are separate for debug/release (`Pilo Dev` / `Pilo`), matching
  their separate Tauri app-data identifiers. Keep plugin versions compatible with
  the locked Tauri runtime; do not upgrade the whole desktop stack for this feature.
- Main close hides, retaining the WebView, event subscriptions, Pi sessions,
  terminals and WebUI service. Session-window close still destroys that window.
  The tray's Hide action hides all windows; Show restores/unminimizes/focuses main.
  Reopening an existing hidden session must show and unminimize it before focus.
- macOS starts with `LSUIElement` in `src-tauri/Info.plist`, applies the chosen
  launch activation policy during setup, and uses Regular for visible windows /
  Accessory when none remain. Do not remove the Dock icon while another session
  window is visible. Windows hidden windows skip the taskbar; restore clears it.
- Use the transparent cloud mark in `assets/branding/tray*.svg`. The 44px RGBA
  template PNG is monochrome for macOS; the 32px RGBA colored PNG is for other
  platforms. `include_image!` embeds pixels at compile time, without requiring
  Tauri's runtime `image-png` feature. macOS left-click opens the menu; Windows
  left-click restores main and right-click opens the menu.
- Register the saved combination through the official global-shortcut plugin
  during native setup, before tray creation. The default `mod+alt+p` resolves to
  `CommandOrControl+Alt+P`. Only Pressed calls `show_main`; Released does nothing.
  All registrations owned by this plugin are show-only, not visibility toggles,
  and remain active while hidden. Keep them separate from frontend keydown
  shortcuts so they work without a focused WebView. No JavaScript plugin
  dependency, plugin IPC permission or Remote WebUI endpoint is needed.
- The desktop-only Settings → Shortcuts → Global recorder reuses shortcut key
  formatting and modifier validation. Record physical letter/digit/punctuation
  keys (`KeyboardEvent.code`), not Option-generated or non-Latin `key` values.
  Escape/blur cancels; modifier-only/unsafe combinations do not save; conflicts
  with current in-app shortcuts are rejected. The backend independently parses
  input and requires Ctrl/Command/Alt or F1–F12. `mod` means CommandOrControl,
  `meta` means Super; other tokens use the native parser.
- Save on a blocking worker, under an immediate SQLite transaction to serialize
  multiple windows. Register the new key before releasing the previous one.
  Registration failure preserves the old key and DB value; release failure
  removes the replacement. Persistence/commit failure attempts to restore the
  old registration and remove the new one; log compensation failures. An
  unchanged active key persists without re-registering. A saved but inactive
  key can be retried or replaced. Never silently overwrite it with the default.
- Show the current platform-specific hint in the localized tray label only
  when registered. The frontend setter refreshes tray labels after success;
  do not also register a menu accelerator for the same combination.
- Tray Quit calls `exit(0)` but must not bypass async resource cleanup. The exit
  guard has running/cleaning/ready stages; repeated quit requests wait during
  cleanup. Only the final exit after cleanup leaves the event loop. Preserve the
  updater's distinct restart exit code.

## 4. Validation & Error Matrix

- Missing/invalid saved mode: log startup read failure and show the main window.
- Tray creation failure: log, disallow hidden startup and let main close normally.
- Settings read failure: show retry UI; write failure: retain the prior selection
  and show a localized error. No optimistic OS-setting persistence.
- Native show/hide/menu failures: log; never silently destroy a live session.
- Global shortcut initialization/registration failure (including another app
  owning the combination): log and continue startup with the normal tray and
  window behavior; omit the shortcut hint rather than claiming it is available.
  Settings show inactive status and offer retry/rebinding. Save failures retain
  the displayed previous value and show localized feedback.

## 5. Good / Base / Bad Cases

- Good: login silently starts the Host; WebUI works while no desktop window shows.
- Base: old installations remain opted out of login startup; manual launch shows.
- Bad: treating main Close as Quit, hiding with no working tray, or reopening a
  duplicate process instead of restoring the hidden window.

## 6. Tests Required

Automated coverage: startup-hidden truth table (mode, launch source, tray
availability), absent/round-tripped SQLite mode, IPC mode payloads and rejection
propagation. Shortcut coverage includes safe/invalid parsing, native replacement
conflicts and persistence rollback, same-key saves, nullable-column migration
and preservation of startup settings, IPC failures and tray refresh, physical
key recording on macOS/Windows layouts, and desktop-only accessible rendering.
Run frontend format/check/build and unit tests, Rust fmt/check/clippy and library
tests.

Native acceptance remains manual: Windows login in both modes, opt-out/restart,
tray Show/Hide/Quit, taskbar removal, repeated launches/quit during active work,
visible/hidden session windows and WebUI availability after main close. macOS
additionally needs packaged-launch Dock behavior, menu-bar dark/light contrast,
reopen and Cmd+Q. Verify the global shortcut from another app after main close,
Hide to Tray and minimization, including hidden autostart, occupied-key fallback
and freeing the shortcut on Quit. Compilation/unit tests do not verify those OS
interactions.

## 7. Wrong vs Correct

Wrong: use browser localStorage to decide native startup, expose autostart over
remote HTTP, or use `std::process::exit` directly from the tray handler.
Correct: native-owned persisted mode, desktop IPC only, official OS registration,
visibility changes instead of destruction, and the existing bounded teardown.
