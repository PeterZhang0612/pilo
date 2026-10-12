import { useState } from "react";

import type { SidebarSession } from "@/components/sidebar/types";
import type { ChatSessionRuntimeState } from "@/lib/chat-session-client";
import {
	chatRuntimeHasOpenTurn,
	runtimeSessionIdFromKey,
} from "@/lib/chat-session-runtime-model";

/**
 * Tracks unread dots for agent runs: a session flips to unread when it goes
 * from running to idle while its process is still running, and clears when
 * selected. A failed/stopped process is not a completed turn. Derived during
 * render from the previous frame's activity to avoid an effect cascade.
 */
export function useSessionUnread(
	sessions: readonly SidebarSession[],
	selectedSessionId: string | null,
	runtimeStates: readonly ChatSessionRuntimeState[],
): ReadonlySet<string> {
	const [sessionUnreadState, setSessionUnreadState] = useState<{
		prevActive: Map<string, boolean>;
		prevRuntimeIds: ReadonlySet<string>;
		unread: ReadonlySet<string>;
	}>(() => ({
		prevActive: new Map(),
		prevRuntimeIds: new Set(),
		unread: new Set(),
	}));
	{
		const {
			prevActive,
			prevRuntimeIds,
			unread: currentUnread,
		} = sessionUnreadState;
		const nextActive = new Map<string, boolean>();
		const nextRuntimeIds = new Set<string>();
		let unread: ReadonlySet<string> = currentUnread;
		let activeChanged = false;
		let runtimeChanged = false;
		for (const session of sessions) {
			const runtime = runtimeStates.find(
				(state) =>
					state.projectId === session.projectId &&
					((session.sessionPath && state.sessionPath === session.sessionPath) ||
						runtimeSessionIdFromKey(state.sessionKey, state.projectId) ===
							session.id),
			);
			if (runtime) nextRuntimeIds.add(session.id);
			if (prevRuntimeIds.has(session.id) !== Boolean(runtime))
				runtimeChanged = true;
			const wasActive = prevActive.get(session.id) === true;
			// Controller busy flags can clear before the runtime snapshot refreshes.
			const active = Boolean(session.active) || chatRuntimeHasOpenTurn(runtime);
			nextActive.set(session.id, active);
			if (!prevActive.has(session.id) || wasActive !== active)
				activeChanged = true;
			if (
				wasActive &&
				!active &&
				// A removed Host runtime was stopped, not successfully settled.
				(runtime
					? runtime.snapshot.state === "running"
					: !prevRuntimeIds.has(session.id)) &&
				session.id !== selectedSessionId &&
				!unread.has(session.id)
			) {
				unread = new Set(unread).add(session.id);
			}
		}
		if (selectedSessionId && unread.has(selectedSessionId)) {
			const cleared = new Set(unread);
			cleared.delete(selectedSessionId);
			unread = cleared;
		}
		for (const id of unread) {
			if (nextActive.has(id)) continue;
			const cleared = new Set(unread);
			cleared.delete(id);
			unread = cleared;
		}
		if (
			activeChanged ||
			runtimeChanged ||
			nextActive.size !== prevActive.size ||
			nextRuntimeIds.size !== prevRuntimeIds.size ||
			unread !== currentUnread
		) {
			setSessionUnreadState({
				prevActive: nextActive,
				prevRuntimeIds: nextRuntimeIds,
				unread,
			});
		}
	}
	return sessionUnreadState.unread;
}
