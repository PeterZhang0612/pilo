# State Management

> There is no Zustand and no TanStack Query. State is layered by lifetime.

---

## Layers

| Kind                   | Where                                                            | Mechanism                                                               |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| App-global prefs/theme | `src/lib/preferences-provider.tsx`, `src/lib/theme-provider.tsx` | React Context + `useState`, exposed via `usePreferences()` / theme hook |
| App-global locale      | `src/i18n/`                                                      | i18next instance + `useTranslation()`; bootstrap before React renders   |
| App shell state        | `src/App.tsx`                                                    | `useState` + orchestration hooks in `src/components/app/`               |
| Feature state          | feature components                                               | `useState` / `useReducer`                                               |
| Hot runtime state      | `src/components/chat/chat-conversation-store.ts`                 | external store + `useSyncExternalStore`                                 |
| Server data            | `src/lib/api/*.ts`                                                   | `invoke`/`listen`, results held in component/feature state              |

## Rules

- **No new global store library.** Add state at the lowest layer that owns it.
- Context providers are for values read widely and written rarely (preferences,
  theme). Do not put high-frequency streaming state in context — it re-renders
  every consumer.
- For state that changes outside React (Pi event stream, controllers), use the
  external-store pattern so only mounted subscribers re-render:

```ts
export function createChatConversationStore() {
	let snapshot: ConversationState | undefined;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		setSnapshot(next: ConversationState) {
			if (snapshot === next) return;
			snapshot = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
```

Consume it with `useSyncExternalStore(store.subscribe, store.getSnapshot)`.

WebUI uses this same conversation store. `RemoteConversationViewport` subscribes
to the full snapshot and renders the shared `ChatConversationViewport`; the
workspace hook subscribes only to a cached projection of activity, message
count, pending users and interruption status. Keep the projection reference
stable on text/thinking/tool deltas, or the entire shell re-renders again.
The setter updates the projection before publishing the store snapshot.

Web event frames coalesce adjacent deltas and use `reduceConversationActions`.
Flush at user/non-assistant boundaries and after `assistant_turn_end` before
deciding whether the next action must adopt an external live turn. Fork actions
obtain the latest messages on click, before their first await, rather than
subscribing shell callbacks to every streaming message change.

- Local state that must survive remounts is cached in module/state-cache files
  (`chat-ui-state-cache.ts`, `chat-history-window-store.ts`).
- Locale is app-global low-frequency state owned by the i18n layer. Persist the
  user's choice, resolve system language only when no valid choice exists, and
  never store localized strings in domain/state-machine state.
- Virtualization/scroll state uses dedicated stores/hooks
  (`@tanstack/react-virtual`, `chat-history-window-store`) — keep it out of
  React state to avoid re-render storms.

## Font Preferences

- Font preferences are device-local (`pilo.preferences.v1` in `localStorage`),
  not synchronized between desktop and WebUI. UI, reading, code and terminal
  fonts/sizes are independent. Defaults are UI 15px, reading 16px, code 14px and
  terminal 14px; accepted sizes are finite numbers within the ranges in
  `src/lib/font-settings.ts`.
- UI scaling uses a fixed 14px Tailwind `text-sm` baseline, not the configurable
  default size. Reading/code/terminal sizes stay independent of rem geometry.
  Legacy `pageFontSize` / `conversationFontSize` migrate to reading size;
  a missing reading font family falls back to the stored page font family.
- `resetFontFamilies()` resets only the four families; `resetFontSizes()` resets
  only the four sizes. Neither action changes unrelated preferences.
- `src/main.tsx` marks the HTML root with `data-remote-webui` before WebUI boot,
  including pairing, error pages and portaled menus. At widths up to 1023px,
  mobile UI text uses the former default scale (`text-sm` 16px with the normal
  browser root size), without scaling rem geometry. UI/reading fonts use the
  fixed Inter/system sans-serif stack; composer text has a 16px iOS focus-zoom
  floor. Desktop preferences must not be overridden by these mobile rules.
- Shared composer sizing uses actual line height, a 12-line cap and remaining
  chat-panel space after surrounding controls/safe-area padding. Observe both
  the panel and composer region; ignore region changes caused only by textarea
  height, coalesce resize callbacks in animation frames and clean up on unmount.

## Forbidden

- Introducing Zustand/TanStack Query for a new feature without an explicit
  project decision.
- Duplicating server state into a global store as a cache.
- Persisting derived state; recompute from source.
