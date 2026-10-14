import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {
	decodeNextPromptResult,
	type NextPromptRequest,
} from "@/lib/next-prompt";
import type { PiloClient, PiloClientEventMessage } from "@/lib/pilo-client";
import type { PiModel, PiloRuntimeEvent } from "@/lib/pi-runtime";
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
	const eligible =
		!config.saving &&
		options.active &&
		!options.blocked &&
		!options.draft &&
		!options.hasAttachments &&
		Boolean(config.settings?.enabled);
	const latestRef = useRef({ options, config, key, eligible });
	useLayoutEffect(() => {
		latestRef.current = { options, config, key, eligible };
	}, [options, config, key, eligible]);

	const dismiss = useCallback(() => {
		const pending = pendingRef.current;
		pendingRef.current = null;
		if (pending) {
			clearTimeout(pending.timer);
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
				dismiss();
			if (!live || event.sessionKey !== current.options.sessionKey) return;
			if (
				event.type === "assistant_message_start" ||
				event.type === "user_message_start" ||
				event.type === "runtime_error" ||
				(event.type === "process_state" && event.state !== "running")
			) {
				dismiss();
				return;
			}
			if (event.type === "assistant_message_end") {
				dismiss();
				if (
					current.eligible &&
					current.options.sessionId &&
					event.stopReason !== "error" &&
					event.stopReason !== "aborted"
				) {
					setCompletion({ generation: event.generation, key: current.key });
				}
				return;
			}
			const decoded = decodeNextPromptResult(event);
			const pending = pendingRef.current;
			if (
				!decoded ||
				!pending ||
				!("generation" in event) ||
				event.generation !== pending.request.generation ||
				decoded.requestId !== pending.request.requestId ||
				decoded.sessionId !== pending.request.sessionId ||
				decoded.revision !== pending.request.revision ||
				pending.key !== current.key ||
				!current.eligible ||
				current.options.busy
			)
				return;
			clearTimeout(pending.timer);
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
				dismiss();
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
		dismiss();
		return dismiss;
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
		if (options.busy) dismiss();
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
		const timer = setTimeout(() => {
			if (pendingRef.current?.request.requestId === request.requestId)
				dismiss();
		}, 7000);
		pendingRef.current = { client: options.client, request, key, timer };
		void options.client.requestNextPrompt(request).catch(() => {
			if (pendingRef.current?.request.requestId !== request.requestId) return;
			dismiss();
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
					if (!connected) dismiss();
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
