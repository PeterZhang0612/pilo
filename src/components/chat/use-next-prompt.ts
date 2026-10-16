import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {
	decodeNextPromptResult,
	traceNextPrompt,
	type NextPromptRequest,
} from "@/lib/next-prompt";
import type { PiloClient, PiloClientEventMessage } from "@/lib/api/pilo-client";
import type { PiModel, PiloRuntimeEvent } from "@/lib/api/pi-runtime";
import { useNextPromptSettings } from "@/lib/use-next-prompt-settings";
import { randomId } from "@/lib/utils";

type Options = {
	client: PiloClient | null;
	connectionId: string;
	sessionKey: string | null;
	sessionId: string | null;
	draft: string;
	hasAttachments: boolean;
	active: boolean;
	busy: boolean;
	blocked: boolean;
	model: PiModel | null;
	/** Desktop uses the existing multiplexed event channel; WebUI supplies its socket frames. */
	subscribe?: boolean;
	refreshKey?: string;
};

export function useNextPrompt(options: Options) {
	const config = useNextPromptSettings(
		options.client,
		options.connectionId,
		options.refreshKey,
	);
	const [completion, setCompletion] = useState<{
		generation: number;
		key: string;
	} | null>(null);
	const [result, setResult] = useState<{
		key: string;
		text: string | null;
		unavailable: boolean;
	} | null>(null);
	const pendingRef = useRef<{
		client: PiloClient;
		request: NextPromptRequest;
		key: string;
		startedAtMs: number;
		received: boolean;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);
	const liveFloorRef = useRef(Number.POSITIVE_INFINITY);
	const key = JSON.stringify([
		options.connectionId,
		options.sessionKey,
		options.sessionId,
		options.model?.provider,
		options.model?.id,
		config.settings?.updatedAtMs,
	]);
	let ineligibleReason: string | null = null;
	if (config.saving) ineligibleReason = "settings_saving";
	else if (!options.active) ineligibleReason = "inactive";
	else if (options.blocked) ineligibleReason = "blocked";
	else if (options.draft) ineligibleReason = "draft_present";
	else if (options.hasAttachments) ineligibleReason = "attachments_present";
	else if (!config.settings?.enabled) ineligibleReason = "disabled";
	const eligible = ineligibleReason === null;
	const latestRef = useRef({
		options,
		config,
		key,
		eligible,
		ineligibleReason,
	});
	useLayoutEffect(() => {
		latestRef.current = { options, config, key, eligible, ineligibleReason };
	}, [options, config, key, eligible, ineligibleReason]);

	const dismiss = useCallback((reason = "dismissed") => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (pending) {
			clearTimeout(pending.timer);
			traceNextPrompt(pending.received ? "release" : "cancel", {
				...pending.request,
				reason,
				elapsedMs: Date.now() - pending.startedAtMs,
			});
			void pending.client
				.requestNextPrompt({ ...pending.request, cancel: true })
				.catch(() => undefined);
		}
		setCompletion(null);
		setResult(null);
	}, []);

	const handleEvent = useCallback(
		(event: PiloRuntimeEvent, live = true) => {
			const current = latestRef.current;
			current.config.handleEvent(event);
			if (
				event.type === "next_prompt_settings_changed" &&
				event.settings.connectionId === current.options.connectionId &&
				event.settings.updatedAtMs >
					(current.config.settings?.updatedAtMs ?? -1)
			)
				dismiss("settings_changed");
			if (!live || event.sessionKey !== current.options.sessionKey) return;
			if (
				event.type === "assistant_message_start" ||
				event.type === "user_message_start" ||
				event.type === "runtime_error" ||
				(event.type === "process_state" && event.state !== "running")
			) {
				dismiss(event.type);
				return;
			}
			if (event.type === "assistant_message_end") {
				dismiss("new_completion");
				if (
					current.eligible &&
					current.options.sessionId &&
					event.stopReason !== "error" &&
					event.stopReason !== "aborted"
				) {
					setCompletion({ generation: event.generation, key: current.key });
				} else if (current.config.settings?.enabled) {
					traceNextPrompt("skipped", {
						sessionKey: current.options.sessionKey ?? undefined,
						generation: event.generation,
						reason:
							current.ineligibleReason ??
							(!current.options.sessionId
								? "missing_session"
								: "completion_failed"),
					});
				}
				return;
			}
			const decoded = decodeNextPromptResult(event);
			const pending = pendingRef.current;
			if (!decoded) {
				if (
					pending &&
					event.type === "extension_ui_request" &&
					event.widgetKey === "pilo.next-prompt.v1"
				)
					traceNextPrompt("discard", {
						...pending.request,
						reason: "invalid_result",
					});
				return;
			}
			let discardReason: string | null = null;
			if (!pending) discardReason = "no_request";
			else if (
				!("generation" in event) ||
				event.generation !== pending.request.generation
			)
				discardReason = "generation_changed";
			else if (decoded.requestId !== pending.request.requestId)
				discardReason = "request_changed";
			else if (decoded.sessionId !== pending.request.sessionId)
				discardReason = "session_changed";
			else if (decoded.revision !== pending.request.revision)
				discardReason = "revision_changed";
			else if (pending.key !== current.key) discardReason = "config_changed";
			else if (!current.eligible) discardReason = current.ineligibleReason;
			else if (current.options.busy) discardReason = "busy";
			if (discardReason || !pending) {
				traceNextPrompt("discard", {
					sessionKey: current.options.sessionKey ?? undefined,
					requestId: decoded.requestId,
					status: decoded.status,
					reason: discardReason ?? "no_request",
					elapsedMs: pending ? Date.now() - pending.startedAtMs : undefined,
				});
				return;
			}
			clearTimeout(pending.timer);
			pending.received = true;
			traceNextPrompt("result", {
				...pending.request,
				status: decoded.status,
				elapsedMs: Date.now() - pending.startedAtMs,
			});
			setResult({
				key: current.key,
				text: decoded.status === "ready" ? decoded.text : null,
				unavailable: decoded.status === "unavailable",
			});
		},
		[dismiss],
	);

	const handleMessage = useCallback(
		(message: PiloClientEventMessage) => {
			if (message.type !== "events") {
				liveFloorRef.current = message.latestSequence;
				dismiss("transport_resync");
				void latestRef.current.config.refresh();
				return;
			}
			for (const event of message.events) {
				const live = event.sequence > liveFloorRef.current;
				if (live) liveFloorRef.current = event.sequence;
				handleEvent(event, live);
			}
		},
		[dismiss, handleEvent],
	);

	/* oxlint-disable react/set-state-in-effect -- Editor/run/config changes invalidate asynchronous input assistance, never restore it. */
	/* oxlint-disable react/exhaustive-effect-dependencies -- These identity/editor/transport dependencies intentionally invalidate pending work on every change, even when not read by the cleanup. */
	useEffect(() => {
		dismiss(latestRef.current.ineligibleReason ?? "editor_or_config_changed");
		return () =>
			dismiss(latestRef.current.ineligibleReason ?? "view_or_config_changed");
	}, [
		dismiss,
		key,
		config.saving,
		options.client,
		options.draft,
		options.hasAttachments,
		options.active,
		options.blocked,
		options.refreshKey,
	]);
	/* oxlint-enable react/exhaustive-effect-dependencies */
	useEffect(() => {
		if (options.busy) dismiss("busy");
	}, [dismiss, options.busy]);
	useEffect(() => {
		if (
			!completion ||
			options.busy ||
			!eligible ||
			completion.key !== key ||
			!options.client ||
			!options.sessionKey ||
			!options.sessionId ||
			!config.settings
		)
			return;
		setCompletion(null);
		const request: NextPromptRequest = {
			sessionKey: options.sessionKey,
			sessionId: options.sessionId,
			requestId: randomId(),
			generation: completion.generation,
			revision: config.settings.updatedAtMs,
		};
		const startedAtMs = Date.now();
		traceNextPrompt("request", request);
		const timer = setTimeout(() => {
			if (pendingRef.current?.request.requestId !== request.requestId) return;
			traceNextPrompt("timeout", {
				...request,
				elapsedMs: Date.now() - startedAtMs,
			});
			dismiss("client_timeout");
		}, 20_000);
		pendingRef.current = {
			client: options.client,
			request,
			key,
			startedAtMs,
			received: false,
			timer,
		};
		void options.client.requestNextPrompt(request).catch(() => {
			if (pendingRef.current?.request.requestId !== request.requestId) return;
			traceNextPrompt("rejected", {
				...request,
				elapsedMs: Date.now() - startedAtMs,
			});
			dismiss("request_rejected");
			setResult({ key, text: null, unavailable: true });
		});
	}, [
		completion,
		options.busy,
		eligible,
		key,
		options.client,
		options.sessionKey,
		options.sessionId,
		config.settings,
		dismiss,
	]);
	/* oxlint-enable react/set-state-in-effect */

	useEffect(() => {
		if (!options.subscribe || !options.client) return;
		let disposed = false;
		let stop: (() => void) | undefined;
		void options.client
			.connectEvents({
				onMessage: (message) => {
					if (message.type === "events")
						for (const event of message.events) handleEvent(event);
				},
				onStatus: (connected) => {
					if (!connected) dismiss("transport_disconnected");
				},
			})
			.then((unlisten) => {
				if (disposed) unlisten();
				else stop = unlisten;
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
			stop?.();
		};
	}, [options.client, options.subscribe, handleEvent, dismiss]);

	return {
		config,
		handleMessage,
		dismiss,
		text: eligible && !options.busy && result?.key === key ? result.text : null,
		unavailable: result?.key === key && result.unavailable,
	};
}
