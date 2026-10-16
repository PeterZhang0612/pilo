import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listConnectionCatalog } from "@/lib/api/connections";
import { connectionLabel } from "@/lib/api/projects";
import type { Connection, PiModel } from "@/lib/api/pi-runtime";
import { tauriPiloClient } from "@/lib/api/tauri-pilo-client";
import { CacheKeepAliveSettingsFields } from "./cache-keep-alive-settings";
import { SETTINGS_CONTAINER_CLASS } from "./compact-layout";

export function ConnectionCacheKeepAliveSettings() {
	const { t } = useTranslation();
	const [catalog, setCatalog] = useState<
		{ connection: Connection; models: PiModel[] }[]
	>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let disposed = false;
		void Promise.all([listConnectionCatalog(), tauriPiloClient.bootstrap()])
			.then(async ([connections, snapshot]) => {
				const caches = await Promise.all(
					snapshot.projects.map(async (project) => ({
						connectionId: project.connection.id,
						catalog: await tauriPiloClient.loadModels(project.id),
					})),
				);
				if (!disposed)
					setCatalog(
						connections.map((connection) => ({
							connection,
							models: caches
								.filter((cache) => cache.connectionId === connection.id)
								.flatMap((cache) => cache.catalog?.models ?? []),
						})),
					);
			})
			.catch((cause: unknown) => {
				if (!disposed)
					setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => {
			disposed = true;
		};
	}, []);
	return (
		<div className={SETTINGS_CONTAINER_CLASS}>
			<p className="text-xs leading-5 text-muted-foreground">
				{t("settings.cacheKeepAliveDescription")}
			</p>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			{catalog.map(({ connection, models }) => (
				<CacheKeepAliveSettingsFields
					key={connection.id}
					client={tauriPiloClient}
					connectionId={connection.id}
					connectionName={connectionLabel(connection)}
					models={models}
				/>
			))}
		</div>
	);
}
