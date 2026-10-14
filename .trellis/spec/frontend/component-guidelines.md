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
- In-conversation find reuses `jumpToMessageIndex` from
  `use-chat-scroll-controller.ts` for programmatic jumps; message plain text
  comes from `messageSearchText` in `src/lib/conversation-outline.ts` so the
  outline and the finder share one extraction path.

## Copy

- User-facing strings are Simplified Chinese (`"复制"`, `"重试"`, …), matching the
  existing UI. Keep code identifiers and comments in English.
