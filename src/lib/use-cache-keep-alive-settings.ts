import { useCallback, useEffect, useRef, useState } from "react";

import type {
	CacheKeepAliveSettings,
	CacheKeepAliveStatus,
} from "@/lib/cache-keep-alive";
import type { PiloClient } from "@/lib/api/pilo-client";
import { runtimeErrorMessage } from "@/lib/api/pi-runtime";

export function useCacheKeepAliveSettings(
	client: PiloClient,
	connectionId: string,
	sessionKey?: string,
) {
	const scope = JSON.stringify([connectionId, sessionKey]);
	const [state, setState] = useState<{
		scope: string;
		settings: CacheKeepAliveSettings[];
		status: CacheKeepAliveStatus | null;
		unavailable: boolean;
		loading: boolean;
		saving: boolean;
		error: string | null;
	}>({
		scope,
		settings: [],
		status: null,
		unavailable: false,
		loading: true,
		saving: false,
		error: null,
	});
	const saveQueue = useRef(Promise.resolve());
	const pendingSaves = useRef(0);
	useEffect(() => {
		let disposed = false;
		let pending = false;
		async function refresh() {
			if (pending) return;
			pending = true;
			try {
				const [settings, runtime] = await Promise.all([
					client.loadCacheKeepAliveSettings(connectionId),
					sessionKey ? client.chatState(sessionKey) : Promise.resolve(null),
				]);
				if (disposed) return;
				setState((current) => {
					const merged = new Map(
						(current.scope === scope ? current.settings : []).map((row) => [
							JSON.stringify([row.provider, row.modelId]),
							row,
						]),
					);
					for (const row of settings) {
						const key = JSON.stringify([row.provider, row.modelId]);
						if ((merged.get(key)?.updatedAtMs ?? -1) <= row.updatedAtMs)
							merged.set(key, row);
					}
					return {
						scope,
						settings: [...merged.values()],
						status: runtime?.cacheKeepAlive ?? null,
						unavailable:
							runtime?.snapshot.state === "running" && !runtime.cacheKeepAlive,
						loading: false,
						saving: current.saving,
						error: current.scope === scope ? current.error : null,
					};
				});
			} catch (cause) {
				if (!disposed)
					setState((current) => ({
						...(current.scope === scope
							? current
							: {
									scope,
									settings: [],
									status: null,
									unavailable: false,
									saving: false,
								}),
						loading: false,
						error: runtimeErrorMessage(cause),
					}));
			} finally {
				pending = false;
			}
		}
		void refresh();
		// Settings/status polling is read-only; no browser timer schedules paid requests.
		const timer = window.setInterval(() => void refresh(), 5000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [client, connectionId, scope, sessionKey]);
	const save = useCallback(
		(settings: CacheKeepAliveSettings) => {
			pendingSaves.current += 1;
			// Blur saves and toggles must not drop each other's updates.
			const request = saveQueue.current.then(async () => {
				setState((current) => ({ ...current, saving: true, error: null }));
				try {
					const saved = await client.saveCacheKeepAliveSettings(settings);
					setState((current) => {
						if (current.scope !== scope) return current;
						const merged = new Map(
							current.settings.map((row) => [
								JSON.stringify([row.provider, row.modelId]),
								row,
							]),
						);
						const key = JSON.stringify([saved.provider, saved.modelId]);
						if ((merged.get(key)?.updatedAtMs ?? -1) <= saved.updatedAtMs)
							merged.set(key, saved);
						return { ...current, settings: [...merged.values()] };
					});
					return true;
				} catch (cause) {
					setState((current) =>
						current.scope !== scope
							? current
							: { ...current, error: runtimeErrorMessage(cause) },
					);
					return false;
				} finally {
					pendingSaves.current -= 1;
					setState((current) => ({
						...current,
						saving: pendingSaves.current > 0,
					}));
				}
			});
			saveQueue.current = request.then(() => {});
			return request;
		},
		[client, scope],
	);
	return {
		settings: state.scope === scope ? state.settings : [],
		status: state.scope === scope ? state.status : null,
		unavailable: state.scope === scope && state.unavailable,
		loading: state.scope !== scope || state.loading,
		saving: state.saving,
		error: state.scope === scope ? state.error : null,
		save,
	};
}
