import { fileMentionPath } from "@/lib/chat/chat-mentions";

// Keep ownership across composer remounts, but never adopt existing/history files.
const pendingFiles = new Map<string, () => Promise<void>>();

export function registerChatFile(path: string, remove: () => Promise<void>) {
	pendingFiles.set(path, remove);
	return path;
}

export function discardChatFiles(paths: readonly string[]) {
	for (const path of paths) {
		const remove = pendingFiles.get(path);
		if (!remove) continue;
		pendingFiles.delete(path);
		void remove().catch((error: unknown) => {
			console.warn("Failed to clean up chat attachment", error);
		});
	}
}

function filePaths(text: string) {
	return text.split("\n").flatMap((line) => {
		const path = fileMentionPath(line);
		return path ? [path] : [];
	});
}

export function discardRemovedChatFiles(previous: string, next: string) {
	const remaining = new Set(filePaths(next));
	discardChatFiles(filePaths(previous).filter((path) => !remaining.has(path)));
}

/** Protect submissions before handing them to async commands, queues or recovery. */
export function retainChatFiles(text: string) {
	for (const path of filePaths(text)) pendingFiles.delete(path);
}
