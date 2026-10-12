import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatSessionRuntimeState } from "@/components/chat/chat-page-utils";
import type {
	PiAgentState,
	PiModel,
	PiSessionStats,
	PiThinkingLevel,
} from "@/lib/pi-runtime";
import type { ProjectPiModels } from "@/lib/pi-models";
import { reconcilePiModelCatalog } from "@/lib/pi-model-selection";
import { runtimeErrorMessage } from "@/lib/pi-runtime";
import type { SessionIndexEntry } from "@/lib/sessions";
import type { RemoteRpc } from "./use-remote-chat-transport";
import type { WebPiloClient } from "./web-pilo-client";

type UseRemoteChatAgentConfigOptions = {
	client: WebPiloClient | null;
	rpc: RemoteRpc;
	activeProjectId: string;
	draftId: string;
	selectedSession: SessionIndexEntry | null;
};

export function useRemoteChatAgentConfig({
	client,
	rpc,
	activeProjectId,
	draftId,
	selectedSession,
}: UseRemoteChatAgentConfigOptions) {
	const [agentState, setAgentState] = useState<PiAgentState | null>(null);
	const [chatState, setChatState] = useState<ChatSessionRuntimeState | null>(
		null,
	);
	const [models, setModels] = useState<PiModel[]>([]);
	const [modelsLoaded, setModelsLoaded] = useState(false);
	// 仅用于 composer 的模型刷新按钮；与 Desktop 的 modelLoadState 对齐，
	// 不再是「下拉菜单首行」文案。
	const [modelLoading, setModelLoading] = useState(false);
	const [modelError, setModelError] = useState<string | null>(null);
	const [catalog, setCatalog] = useState<ProjectPiModels | null>(null);
	const [thinkingLevels, setThinkingLevels] = useState<PiThinkingLevel[]>([]);
	const [draftModel, setDraftModel] = useState<PiModel | null>(null);
	const [draftThinkingLevel, setDraftThinkingLevel] =
		useState<PiThinkingLevel | null>(null);
	const draftCatalogRequestRef = useRef(0);
	const configKey = selectedSession?.sessionPath ?? draftId;
	const configIdentityRef = useRef({ projectId: activeProjectId, configKey });

	const refreshAgentConfig = useCallback(
		async (liveRuntime = true) => {
			if (
				configIdentityRef.current.projectId !== activeProjectId ||
				configIdentityRef.current.configKey !== configKey
			)
				return;
			const requestId = ++draftCatalogRequestRef.current;
			setModelLoading(true);
			setModelError(null);
			try {
				const [liveResult, hostResult] = await Promise.allSettled([
					liveRuntime
						? Promise.all([
								rpc<PiAgentState>({ type: "get_state" }),
								rpc<{ models: PiModel[] }>({ type: "get_available_models" }),
								rpc<{ levels: PiThinkingLevel[] }>({
									type: "get_available_thinking_levels",
								}),
								rpc<PiSessionStats>({ type: "get_session_stats" }),
							])
						: Promise.resolve(null),
					client?.loadModels(activeProjectId) ?? Promise.resolve(null),
				]);
				if (draftCatalogRequestRef.current !== requestId) return;
				const hostCatalog =
					hostResult.status === "fulfilled" ? hostResult.value : null;
				if (hostResult.status === "fulfilled") {
					setCatalog(hostCatalog);
					// A live refresh must not replace availability with Host cache data.
					if (!liveRuntime) {
						setModelsLoaded(hostCatalog !== null);
						setModels(hostCatalog?.models ?? []);
					}
				}
				if (liveResult.status === "rejected") throw liveResult.reason;
				if (hostResult.status === "rejected")
					setModelError(runtimeErrorMessage(hostResult.reason));
				if (!liveResult.value) return;
				const [state, modelResult, thinkingResult, stats] = liveResult.value;
				setModelsLoaded(true);
				setAgentState(state);
				setModels(
					reconcilePiModelCatalog(
						modelResult.models,
						hostCatalog?.models ?? [],
					),
				);
				setThinkingLevels(thinkingResult.levels);
				setChatState({
					name: state.sessionName,
					tokens: stats.tokens,
					cost: stats.cost,
					contextTokens: stats.contextUsage?.tokens,
					contextWindow: stats.contextUsage?.contextWindow,
					contextPercent: stats.contextUsage?.percent,
				});
			} catch (error) {
				if (draftCatalogRequestRef.current === requestId)
					setModelError(runtimeErrorMessage(error));
			} finally {
				if (draftCatalogRequestRef.current === requestId)
					setModelLoading(false);
			}
		},
		[activeProjectId, client, configKey, rpc],
	);

	const loadDraftCatalog = useCallback(
		(projectId: string) => {
			if (configIdentityRef.current.projectId !== projectId)
				return Promise.resolve();
			const requestId = ++draftCatalogRequestRef.current;
			setModelLoading(true);
			setModelError(null);
			return (client?.loadModels(projectId) ?? Promise.resolve(null))
				.then((loaded) => {
					if (draftCatalogRequestRef.current !== requestId) return;
					setCatalog(loaded);
					setModelsLoaded(loaded !== null);
					setModels(loaded?.models ?? []);
					if (!loaded) return;
					setDraftModel((current) => current ?? loaded.defaultModel);
					setDraftThinkingLevel(
						(current) => current ?? loaded.defaultThinkingLevel,
					);
				})
				.catch((error) => {
					if (draftCatalogRequestRef.current !== requestId) return;
					setModelError(runtimeErrorMessage(error));
				})
				.finally(() => {
					if (draftCatalogRequestRef.current === requestId)
						setModelLoading(false);
				});
		},
		[client],
	);

	/* oxlint-disable react/set-state-in-effect -- Reset catalog identity before resolving another project/session. */
	useEffect(() => {
		configIdentityRef.current = { projectId: activeProjectId, configKey };
		setCatalog(null);
		setModels([]);
		setModelsLoaded(false);
		setModelLoading(false);
		setModelError(null);
		draftCatalogRequestRef.current += 1;
		return () => {
			draftCatalogRequestRef.current += 1;
		};
	}, [activeProjectId, configKey]);
	/* oxlint-enable react/set-state-in-effect */

	/* oxlint-disable react/set-state-in-effect, react/exhaustive-effect-dependencies -- The draft landing page preloads the Host-cached Pi model catalog, and draftId intentionally retriggers it for every new draft. */
	useEffect(() => {
		void draftId;
		if (selectedSession || !activeProjectId) return;
		void loadDraftCatalog(activeProjectId);
		return () => {
			draftCatalogRequestRef.current += 1;
		};
	}, [activeProjectId, draftId, loadDraftCatalog, selectedSession]);
	/* oxlint-enable react/set-state-in-effect, react/exhaustive-effect-dependencies */

	return {
		agentState,
		setAgentState,
		chatState,
		setChatState,
		models,
		setModels,
		modelLoading,
		modelsLoaded,
		modelError,
		catalog,
		thinkingLevels,
		setThinkingLevels,
		draftModel,
		setDraftModel,
		draftThinkingLevel,
		setDraftThinkingLevel,
		refreshAgentConfig,
		loadDraftCatalog,
	};
}
