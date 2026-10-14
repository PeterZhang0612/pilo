import type {
	NextPromptModel,
	NextPromptSettings,
	NextPromptRequest,
} from "@/lib/next-prompt";
import type {
	PiloClient,
	PiloClientBootstrap,
	PiloClientEventOptions,
	PiloClientHistoryOptions,
	PiloClientStartChatInput,
} from "@/lib/pilo-client";
import type { PiSessionSnapshot } from "@/lib/pi-runtime";
import type { SessionReadState } from "@/lib/session-read-state";
import type { ProjectPiModels } from "@/lib/pi-models";
import type {
	ProjectModelScope,
	ProjectScopedModel,
} from "@/lib/project-model-scope";
import type {
	SessionDeleteResult,
	SessionExternalActivity,
	SessionHistoryFingerprint,
	SessionHistoryResult,
	SessionIndexEntry,
	SessionSearchMatch,
} from "@/lib/sessions";
import type { ChatSessionRuntimeState } from "@/lib/chat-session-client";
import {
	approveRemoteProjectMcpServer,
	connectRemoteEvents,
	deleteRemoteSession,
	generateRemoteSessionTitle,
	loadRemoteBootstrap,
	loadRemoteChatState,
	loadRemoteHistory,
	loadRemoteHistoryImage,
	loadRemoteProjectImage,
	loadRemoteExternalActivity,
	loadRemoteModels,
	loadRemoteNextPromptSettings,
	saveRemoteNextPromptSettings,
	requestRemoteNextPrompt,
	loadRemoteModelScope,
	saveRemoteModelScope,
	loadRemoteSessions,
	loadRemoteSessionReadStates,
	markRemoteSessionRead,
	searchRemoteFiles,
	searchRemoteSessions,
	sendRemoteChatCommand,
	startRemoteChat,
	stopRemoteChat,
} from "./remote-client";

export class WebPiloClient implements PiloClient {
	constructor(private readonly token: string) {}

	bootstrap(): Promise<PiloClientBootstrap> {
		return loadRemoteBootstrap(this.token);
	}

	listSessions(projectId: string): Promise<SessionIndexEntry[]> {
		return loadRemoteSessions(this.token, projectId);
	}

	loadSessionReadStates(): Promise<SessionReadState[]> {
		return loadRemoteSessionReadStates(this.token);
	}

	markSessionRead(
		projectId: string,
		sessionPath: string,
		revision: number,
	): Promise<SessionReadState> {
		return markRemoteSessionRead(this.token, projectId, sessionPath, revision);
	}

	searchSessions(
		projectId: string,
		query: string,
		limit?: number,
	): Promise<SessionSearchMatch[]> {
		return searchRemoteSessions(this.token, projectId, query, limit);
	}

	externalActivity(projectId: string): Promise<SessionExternalActivity[]> {
		return loadRemoteExternalActivity(this.token, projectId);
	}

	loadHistory(
		projectId: string,
		sessionPath: string,
		options?: PiloClientHistoryOptions,
	): Promise<SessionHistoryResult> {
		return loadRemoteHistory(this.token, projectId, sessionPath, options);
	}

	readHistoryImage(
		projectId: string,
		sessionPath: string,
		imageId: string,
		fingerprint?: SessionHistoryFingerprint,
	): Promise<Uint8Array<ArrayBuffer>> {
		return loadRemoteHistoryImage(
			this.token,
			projectId,
			sessionPath,
			imageId,
			fingerprint,
		);
	}

	readProjectImage(
		projectId: string,
		path: string,
	): Promise<Uint8Array<ArrayBuffer>> {
		return loadRemoteProjectImage(this.token, projectId, path);
	}

	generateSessionTitle(
		projectId: string,
		message: string,
	): Promise<string | null> {
		return generateRemoteSessionTitle(this.token, projectId, message);
	}

	deleteSession(
		projectId: string,
		sessionPath: string,
	): Promise<SessionDeleteResult> {
		return deleteRemoteSession(this.token, projectId, sessionPath);
	}

	loadNextPromptSettings(connectionId: string): Promise<NextPromptSettings> {
		return loadRemoteNextPromptSettings(this.token, connectionId);
	}

	saveNextPromptSettings(
		connectionId: string,
		enabled: boolean,
		model: NextPromptModel | null,
	): Promise<NextPromptSettings> {
		return saveRemoteNextPromptSettings(
			this.token,
			connectionId,
			enabled,
			model,
		);
	}

	requestNextPrompt(request: NextPromptRequest): Promise<void> {
		return requestRemoteNextPrompt(this.token, request);
	}

	startChat(input: PiloClientStartChatInput): Promise<PiSessionSnapshot> {
		return startRemoteChat(this.token, input);
	}

	stopChat(sessionKey: string, reason?: string): Promise<void> {
		return stopRemoteChat(this.token, sessionKey, reason);
	}

	chatState(sessionKey: string): Promise<ChatSessionRuntimeState | null> {
		return loadRemoteChatState(this.token, sessionKey);
	}

	searchFiles(projectId: string, query: string): Promise<string[]> {
		return searchRemoteFiles(this.token, projectId, query);
	}

	loadModels(projectId: string): Promise<ProjectPiModels | null> {
		return loadRemoteModels(this.token, projectId);
	}

	loadModelScope(projectId: string): Promise<ProjectModelScope> {
		return loadRemoteModelScope(this.token, projectId);
	}

	saveModelScope(
		projectId: string,
		models: ProjectScopedModel[] | null,
	): Promise<ProjectModelScope> {
		return saveRemoteModelScope(this.token, projectId, models);
	}

	sendChatCommand(
		sessionKey: string,
		command: Record<string, unknown>,
	): Promise<void> {
		return sendRemoteChatCommand(this.token, sessionKey, command);
	}

	approveProjectMcpServer(
		projectId: string,
		serverName: string,
	): Promise<void> {
		return approveRemoteProjectMcpServer(this.token, projectId, serverName);
	}

	connectEvents(options: PiloClientEventOptions): Promise<() => void> {
		return Promise.resolve(
			connectRemoteEvents(
				this.token,
				options.after,
				options.onMessage,
				options.onStatus,
			),
		);
	}
}
