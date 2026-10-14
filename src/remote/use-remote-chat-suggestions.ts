import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
	piSessionSuggestions,
	type ComposerSuggestion,
} from "@/components/chat/chat-composer-suggestions";
import { createFileSuggestions } from "@/components/chat/chat-file-suggestions";
import {
	createPiCommandSuggestions,
	createPiExtensionCommandNames,
} from "@/lib/pi-command-suggestions";
import type { PiCommand } from "@/lib/pi-runtime";
import type { RemoteSessionRpc } from "./use-remote-chat-transport";
import type { WebPiloClient } from "./web-pilo-client";

type UseRemoteChatSuggestionsOptions = {
	client: WebPiloClient | null;
	activeProjectId: string;
	activeSessionKey: string | null;
	activeSessionKeyRef: RefObject<string | null>;
	runtimeReady: boolean;
	readOnly: boolean;
	ensureDraftRuntime: () => Promise<void>;
	rpcForSession: RemoteSessionRpc;
};

export function useRemoteChatSuggestions({
	client,
	activeProjectId,
	activeSessionKey,
	activeSessionKeyRef,
	runtimeReady,
	readOnly,
	ensureDraftRuntime,
	rpcForSession,
}: UseRemoteChatSuggestionsOptions) {
	const { t } = useTranslation();

	const [fileSuggestions, setFileSuggestions] = useState<ComposerSuggestion[]>(
		[],
	);
	const [commandSuggestions, setCommandSuggestions] = useState<{
		sessionKey: string;
		items: ComposerSuggestion[];
	} | null>(null);
	const extensionCommandNamesRef = useRef<{
		sessionKey: string;
		names: Set<string>;
	} | null>(null);
	const commandLoadingRef = useRef(new Set<string>());
	const fileSuggestionTimerRef = useRef<number | null>(null);
	const fileSuggestionRequestRef = useRef(0);

	const loadCommandCatalog = useCallback(
		async (targetSessionKey: string) => {
			const result = await rpcForSession<{ commands: PiCommand[] }>(
				targetSessionKey,
				{ type: "get_commands" },
			);
			const names = createPiExtensionCommandNames(result.commands);
			if (activeSessionKeyRef.current === targetSessionKey) {
				extensionCommandNamesRef.current = {
					sessionKey: targetSessionKey,
					names,
				};
				setCommandSuggestions({
					sessionKey: targetSessionKey,
					items: createPiCommandSuggestions(result.commands),
				});
			}
			return names;
		},
		[activeSessionKeyRef, rpcForSession],
	);
	const loadCommands = useCallback(async () => {
		// Passive suggestions may query an existing runtime, but must not start Pi.
		if (
			!activeSessionKey ||
			!runtimeReady ||
			readOnly ||
			extensionCommandNamesRef.current?.sessionKey === activeSessionKey ||
			commandLoadingRef.current.has(activeSessionKey)
		)
			return;
		const targetSessionKey = activeSessionKey;
		commandLoadingRef.current.add(targetSessionKey);
		try {
			await loadCommandCatalog(targetSessionKey);
		} catch (error) {
			console.warn("Failed to load Pi commands for remote composer", error);
		} finally {
			commandLoadingRef.current.delete(targetSessionKey);
		}
	}, [activeSessionKey, loadCommandCatalog, readOnly, runtimeReady]);

	// Explicit `/name` submissions may start Pi to resolve extension commands.
	const loadExtensionCommandNames = useCallback(async () => {
		if (!activeSessionKey || readOnly) return null;
		const cached = extensionCommandNamesRef.current;
		if (cached?.sessionKey === activeSessionKey) return cached.names;
		const targetSessionKey = activeSessionKey;
		try {
			await ensureDraftRuntime();
			return await loadCommandCatalog(targetSessionKey);
		} catch {
			return null;
		}
	}, [activeSessionKey, ensureDraftRuntime, loadCommandCatalog, readOnly]);

	const handleSuggestionTrigger = useCallback(
		(trigger: "@" | "/" | null, query: string) => {
			fileSuggestionRequestRef.current += 1;
			const requestId = fileSuggestionRequestRef.current;
			if (fileSuggestionTimerRef.current !== null) {
				window.clearTimeout(fileSuggestionTimerRef.current);
				fileSuggestionTimerRef.current = null;
			}
			if (trigger === "/") {
				setFileSuggestions([]);
				void loadCommands();
				return;
			}
			if (trigger !== "@" || !client || !activeProjectId) {
				setFileSuggestions([]);
				return;
			}
			const normalizedQuery = query.trim();
			fileSuggestionTimerRef.current = window.setTimeout(() => {
				fileSuggestionTimerRef.current = null;
				void client
					.searchFiles(activeProjectId, normalizedQuery)
					.then((paths) => {
						if (fileSuggestionRequestRef.current !== requestId) return;
						setFileSuggestions(createFileSuggestions(paths, normalizedQuery));
					})
					.catch((error) => {
						if (fileSuggestionRequestRef.current !== requestId) return;
						console.warn("Failed to load remote file suggestions", error);
						setFileSuggestions([]);
					});
			}, 120);
		},
		[activeProjectId, client, loadCommands],
	);

	useEffect(
		() => () => {
			fileSuggestionRequestRef.current += 1;
			if (fileSuggestionTimerRef.current !== null) {
				window.clearTimeout(fileSuggestionTimerRef.current);
			}
		},
		[],
	);

	const composerSuggestions = useMemo(
		() => [
			...fileSuggestions,
			...piSessionSuggestions(t),
			...(commandSuggestions?.sessionKey === activeSessionKey
				? commandSuggestions.items
				: []),
		],
		[activeSessionKey, commandSuggestions, fileSuggestions, t],
	);

	return {
		composerSuggestions,
		handleSuggestionTrigger,
		loadExtensionCommandNames,
	};
}
