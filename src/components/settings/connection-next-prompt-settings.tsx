import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { listConnectionCatalog } from "@/lib/api/connections";
import { connectionLabel } from "@/lib/api/projects";
import {
	listenRuntimeEvents,
	type Connection,
	type PiModel,
} from "@/lib/api/pi-runtime";
import { tauriPiloClient } from "@/lib/api/tauri-pilo-client";
import { useNextPromptSettings } from "@/lib/use-next-prompt-settings";
import { NextPromptSettingsFields } from "./next-prompt-settings";
import { SettingsSection, SETTINGS_CONTAINER_CLASS } from "./compact-layout";

function ConnectionSettings({
	connection,
	models,
}: {
	connection: Connection;
	models: readonly PiModel[];
}) {
	const config = useNextPromptSettings(tauriPiloClient, connection.id);
	useEffect(() => {
		let disposed = false;
		let stop: (() => void) | undefined;
		void listenRuntimeEvents(config.handleEvent)
			.then((unlisten) => {
				if (disposed) unlisten();
				else stop = unlisten;
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
			stop?.();
		};
	}, [config.handleEvent]);
	return (
		<NextPromptSettingsFields
			config={config}
			models={models}
			connectionName={connectionLabel(connection)}
		/>
	);
}

export function ConnectionNextPromptSettings() {
	const { t } = useTranslation();
	const [catalog, setCatalog] = useState<{
		connections: Connection[];
		models: Map<string, PiModel[]>;
	}>({ connections: [], models: new Map() });
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
				if (disposed) return;
				const models = new Map<string, PiModel[]>();
				for (const cache of caches)
					models.set(cache.connectionId, [
						...(models.get(cache.connectionId) ?? []),
						...(cache.catalog?.models ?? []),
					]);
				setCatalog({ connections, models });
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
				{t("settings.nextPromptDescription")}
			</p>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<SettingsSection title={t("settings.nextPromptModel")}>
				{catalog.connections.map((connection) => (
					<ConnectionSettings
						key={connection.id}
						connection={connection}
						models={catalog.models.get(connection.id) ?? []}
					/>
				))}
			</SettingsSection>
		</div>
	);
}
