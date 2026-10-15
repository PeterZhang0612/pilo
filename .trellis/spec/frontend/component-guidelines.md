# Component Guidelines

> React component patterns used in this codebase.

---

## Component Style

- Function components only. No class components except the root error boundary
  in `src/main.tsx`.
- Named exports: `export function ChatCopyButton(...)`. `src/App.tsx` uses a
  default export because `main.tsx` imports it that way.
- Inline the props type for small components; declare a named `Props`/options
  type when it is reused or large.

```tsx
export function ChatCopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	...
}
```

## `src/ui` Primitives

Follow the shadcn/ui shape:

- `cva(...)` for variants.
- `React.forwardRef` with a `displayName`.
- `asChild` support via `@radix-ui/react-slot` for polymorphic primitives.
- Classes merged with `cn()` from `@/lib/utils`.

```tsx
const buttonVariants = cva("inline-flex ...", {
	variants: {
		variant: { default: "...", ghost: "...", outline: "..." },
		size: { default: "h-9 px-4 py-2", sm: "h-8 ...", icon: "h-9 w-9" },
	},
	defaultVariants: { variant: "default", size: "default" },
});
```

Feature code composes primitives with `variant`/`size` props instead of
re-styling them.

## Composition & Layout

- Feature components own their layout and state; primitives stay dumb.
- Long/multi-part UI is split into focused files co-located in the feature folder
  (e.g. `chat-composer.tsx`, `chat-composer-frame.tsx`, `chat-composer-actions.tsx`).
- Heavy features are lazy-loaded with `React.lazy` + `Suspense` in `src/App.tsx`
  (`ChatPage`, `ProjectViewer`, `RightSidebar`, `TerminalDock`).

## Large Content

- Command palette recency sorting is memoized O(n log n), not repeated insertion.
  Content search runs projects serially and skips superseded queued queries;
  an already-started project scan still finishes. The server allows at most two
  concurrent content scans per connection server, separate from its 64-request
  overall limit. This is admission control, not cancellation of blocking scans.
- Mobile project sessions render 50 rows per page. Keep selection/deletion
  available on every page, localized controls with 44px touch targets and
  announced page changes. Recent sessions retain their existing 50-row limit.
- Desktop project preview caches highlighting per open tab, including plain-text
  fallback. `highlightProjectFile` skips Shiki above 200,000 code units, 2,000
  lines or 2,000 characters on a line; avoid repeated synchronous tokenization
  when switching tabs. Close drops the tab's cached HTML.
- Git diff parsing is memoized and renders at most 1,000 lines per page; changing
  diff resets the displayed page. Paging limits DOM work, not fetched diff size.
  Files/Git remain desktop-only; do not add generic WebUI filesystem endpoints
  to duplicate these views.

## Styling

The visual system - token meanings, the closed type ramp, radius and shadow
rules, and the named design rules - is documented in
[`docs/DESIGN.md`](../../../docs/DESIGN.md). Read it before changing colors,
spacing, type sizes, or control heights.

- Tailwind utility classes only; design tokens via CSS variables
  (`bg-background`, `text-muted-foreground`, `ring-ring`, …). No hardcoded colors.
- Use `size-4` (not `h-4 w-4`) for square icons.
- Icons come from `lucide-react`; pass them as children to primitives.

## Accessibility

- Interactive icon-only controls need `aria-label`.
- Prefer Radix primitives (Dialog, Tooltip, Select, …) for focus and keyboard
  behavior rather than hand-rolled widgets.
- `oxlint` runs the `jsx-a11y` plugin — accessibility warnings are lint failures.

## Header Actions & Menus

- `SessionHeader` (`src/components/chat/chat-session-header.tsx`) owns the right-side
action group (terminal / temporary chat / panel / session menu). New per-session
actions go there and appear only for persisted sessions (`session && !session.temporary`).
- Session actions that need chat data flow as optional callbacks from `App.tsx`
  through `ChatPage` props (`onRenameSession`, `onOpenInNewWindow`, …). When an
  action targets the focused viewport (e.g. scrolling to a search hit), pass a
  stable callback such as `onNavigate(messageIndex)` instead of a ref — reading
  `ref.current` inside an effect would otherwise fail the `exhaustive-deps` lint.
- Header components expose optional callbacks; they never wire runtime/Pi calls
  themselves. The parent supplies the handlers.
- A newly started desktop chat keeps `ChatSession.id` as its draft controller
  identity, even after Pi identifies the persisted session. Do not replace that
  ID or attach the indexed path just to refresh the menu: runtime/history hooks
  depend on those stable inputs. On desktop, carry `PiAgentState.sessionId` /
  `sessionFile` into the header's `ChatSessionRuntimeState.sessionId` /
  `sessionPath`. Menu display and copy use non-empty live fields, falling back
  to `ChatSession` metadata via `||`; an empty path shows the unavailable label
  and disables copying. WebUI already supplies the Pi identity through
  `headerSession` (identified draft or indexed session); do not duplicate it in
  `chatState`, which can still belong to the previous session during switching.
  Desktop `refreshSessionState(agentState?: PiAgentState)` must publish
  `sessionId` / `sessionFile` / `sessionName` before awaiting session stats;
  delayed or failed stats must not hide a known identity. Pass the already-read
  agent state at turn startup and runtime reattachment, rather than waiting for
  auto-title generation or turn completion. `applyHistoryMetadata` must preserve
  the previous runtime `sessionId` / `sessionPath`: history can finish after
  reattachment and otherwise erase the live identity, exposing the draft ID
  again while the indexed path remains visible.
  Check displayed and copied values during the first reply (before it ends),
  after restoring an active draft runtime, and after history arrives on desktop.
  Also check both clients after the first message and immediately after
  switching WebUI sessions before history/RPC completes.
- Rename and open-in-new-window remain gated by `ChatSession.sessionPath` plus
  their callbacks, not the live runtime path. Their desktop handlers use the
  opened entry's identity/path; identifying a draft updates `piSessionId` but
  does not attach `entry.session.sessionPath`. A new desktop chat can therefore
  allow copying its live path while rename/open remain hidden. Do not make
  these gates match the copy gate without updating the handlers' data flow.

## Multi-Window (Tauri)

- Create additional windows only through `src/lib/window.ts`; do not call the
  Tauri window API directly from components.
- Any new window label pattern must be declared in the `windows` list of
  `src-tauri/capabilities/default.json` (e.g. `"session-*"`), and creating a
  webview window requires the `core:webview:allow-create-webview-window`
  permission. A capability that only lists `"main"` leaves the new window
  without permissions.
- New windows boot stateless: pass state through URL query params and re-resolve
  it once the project index is ready (see `readSessionWindowTarget` and the boot
  effect in `src/App.tsx`, which delegates to `workspace.openSearchSession`).
- In-conversation find uses `findMessageMatches` in `src/lib/chat-message-search.ts`.
  User messages remain literal text. Assistant Markdown is projected through
  the same remark/GFM and raw-HTML/sanitize stages used by Streamdown, retaining
  code contents but excluding link destinations, fence markers and image alt
  attributes. Cache projections by immutable content object/source, and skip
  indexing while the finder is closed. Do not use the outline's
  `messageSearchText`, which strips code fences.
  Assistant hits carry `contentId` and `contentOccurrenceIndex`: highlight only
  the matching `data-chat-search-content-id` text section, not the nth hit in
  the currently mounted message (collapsed work changes that numbering).
  Model and DOM matching share `searchTextMatches`: literal, case-insensitive,
  equivalent whitespace. DOM ranges may cross inline/code-token text nodes;
  omit controls and code headers, and separate block elements consistently.
  Streamdown's `[data-streamdown="code-block-body"] > pre > code > span`
  elements are code lines, not inline tokens: insert line boundaries between
  them. Three lines `high`, `light`, `highlight` must produce only one hit for
  `highlight`, while adjacent token spans within one line remain continuous.
  `[Highlight](https://example.com/Highlight) Highlight` has two targets, not
  three; both targets must have a visible active range.
- `ChatFindLayer` owns the active session's `mod+f` shortcut. Read selected
  text before focusing the find input, including native input/textarea ranges
  but excluding password fields. Normalize whitespace and seed a non-empty
  selection; without one, preserve the query. Repeated shortcuts while open
  must also update the query and focus/select the input after rendering.
  Previous/next actions (including Enter/Shift+Enter) must request navigation
  even when the match index stays unchanged: with one match, manually scrolling
  away and pressing either arrow must return to that exact text range.
- `ChatFindLayer` provides the active match to shared message components. A
  selected intermediate-text hit temporarily opens its work disclosure and
  reveals a bounded content window containing the target; leaving the match
  restores manual expansion state. Forward/backward reveal budgets are separate:
  extending one side must not remove already rendered content or load the other
  side. Anchor the target text when extending a search window, including late
  row measurements; ordinary non-search reveal must not stop bottom-following.
  Manual collapse takes precedence over automatic opening for the current hit;
  a different hit resets that override. Toggle the effective open state, not
  the underlying manual state. Thinking/tool details are not indexed and
  must not contribute DOM matches. `jumpToMessageIndex` mounts the target row,
  then the finder aligns the exact text range; message-top corrections must not
  override that alignment. Observe DOM text/child changes while finding so
  expansion and async Markdown rendering refresh highlights. Verify a message
  with two intermediate hits and two final hits: four ordered targets, correct
  active highlight, automatic work reveal and restored folding on close.
- CSS Custom Highlight uses the global `Highlight` constructor with
  `CSS.highlights`, never `CSS.Highlight`. Prefer the DOM library types over
  assertions that conceal an invalid browser API shape.

## Desktop Updates

- `SidebarFooter` owns one `useDesktopUpdate()` instance and passes it to settings
  and `UpdateDialog`. Startup calls `checkForUpdates({ openDialog: false })`;
  manual checks open the dialog when an update exists. Footer clicks only open
  the dialog, including during downloads; closing it must not cancel the update.
- `UpdateDialog` raises its overlay to `z-[var(--z-dialog)]`: settings content
  already uses that layer, above the default overlay layer. Its portal renders
  after settings, with the update content after its own overlay, so settings is
  dimmed while the update dialog remains on top. Do not raise only the content
  or globally change the shared dialog layer to fix this nested case.
- `useReleaseNotes(version, fallbackNotes, enabled)` reads the matching GitHub
  Release's `body` from `/releases/tags/v{version}`, not `/releases/latest`.
  Release notes can be edited after publishing, while `latest.json` currently
  contains only a short label. Use its notes as a fallback; a notes request
  failure must not block installation. Render Markdown through `ChatMarkdown`.
  Clear failed results when the dialog closes so reopening retries; keep successful
  results cached. A failed response must not trigger a retry loop while open.
- `installUpdate()` in the error state rechecks for updates before another install
  attempt. The check closes the previous `Update` handle, including installer
  bytes retained after an installation failure. Do not download again on that
  same handle: the updater replaces its bytes reference without freeing the old
  resource. After rechecking succeeds, the user can start installation again.
- Download percentages come from updater byte events. If `contentLength` is
  absent, show downloaded bytes and indeterminate progress, not a guessed
  percentage. Use native `progress` and `output` elements.
- This dialog is desktop-only. Keep WebUI's existing PWA toast and refresh
  update flow unchanged; do not invoke the native updater from the browser.

## Copy

- User-facing strings are Simplified Chinese (`"复制"`, `"重试"`, …), matching the
  existing UI. Keep code identifiers and comments in English.

## Session Path References

- `SessionMentionProvider` derives the catalog from the existing project/session
  index. `SessionMentionScope` filters by exact `connection.id`, not transport
  type; same-connection cross-project references are allowed. The lazy-loading
  `ChatPageLoadingFallback` also needs the session connection scope so its enabled
  composer and first-message preview resolve the same references as `ChatPage`.
- `readSessionMentionDraft` / `writeSessionMentionDraft` in
  `src/lib/session-mentions.ts` keep references as trailing `@path` lines in the
  ordinary draft/submission string. Do not read or inject conversation content,
  add a second conversation store, or serialize titles instead of paths.
- Keep the native textarea for body editing. Composer references use compact
  `SessionMentionBadge` chips (icon + title) in the same wrapping row before the
  textarea, not a separate attachment row. The default badge remains unchanged
  for live/history user messages and Skill instructions. Unknown/deleted paths
  remain visible as ordinary text.
- Textarea autosizing keeps a whole-pixel minimum from `rows × lineHeight` plus
  padding/borders for both empty and non-empty text. Integer `scrollHeight` must
  not shrink that minimum on the first character and shift the inline chips.
- With a collapsed caret at body offset 0, Backspace removes the last reference
  atomically; elsewhere, text deletion and selection stay native. Handle mobile
  `beforeinput` / `deleteContentBackward` as well as keyboard Backspace, without
  intercepting IME composition or allowing changes while the composer is disabled.
- Composer suggestion/caret operations use visible body text; submission creation,
  input-history cursor validation, queues and recovery must use the full string.
  Append reference lines after the body so slash commands retain their prefix.
  `createChatSubmission` in `src/lib/chat-submission.ts` ensures an ASCII space
  separates a slash-command name from following text: Pi splits Skill/extension
  names on a literal space, not arbitrary whitespace. Submit `/skill:foo` plus a
  reference as `/skill:foo \n@path`, not `/skill:foo\n@path`. Do this only at
  submission creation, never during draft editing (which would move the caret).
  Preserve existing spaces, bare commands and ordinary messages; keep multiline
  instructions intact and add the command separator before their first newline.
- A new `@` starts on the file category. Tab cycles categories without entering
  results; typing or Down enters results, where Tab/Enter completes. Up from the
  first result returns to categories. Empty results must not swallow submission
  of uncatalogued slash commands or ordinary text.
- Switching `@` categories changes filtering only: keep the file trigger/query
  active so existing and in-flight results survive without clearing or refetching.
  Reuse the panel DOM; list height follows its contents with a viewport-bounded
  maximum, not a fixed height. Show the Tab-switch hint beside the categories
  only while category navigation is active; in results, Tab completes instead.
- Only the desktop provider enables pointer dragging. Recheck connection and
  catalog membership on insertion; never enable native HTML5 dragging or touch
  drag on the WebUI. Keep existing project sorting and row action buttons intact.
- Mobile uses clickable categories/results, 44px coarse-pointer targets, a
  viewport-bounded results list, and a tappable path popover rather than hover.
