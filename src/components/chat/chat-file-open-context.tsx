import { useEffect, useSyncExternalStore } from "react";

/**
 * 打开当前连接中的文件（桌面端落到右侧 ProjectViewer）。
 *
 * 工具行要把文件路径变成可点入口，但消息渲染层级有五六层，逐层传参会污染
 * 一路上的组件签名。这里沿用聊天区既有的模块级 external store 做法
 * （见 chat-image-viewer 的图片查看器）：App 注册动作，工具行订阅读取。
 * WebUI 没有查看器，也就没有注册者，读到 null 时工具行退回不可点的纯文本。
 */
type ChatFileOpenHandler = (path: string) => void;
type ChatFileOpener = {
	openFile: ChatFileOpenHandler;
	canOpenFile: (path: string) => boolean;
};

let opener: ChatFileOpener | null = null;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useChatFileOpener(
	onOpenFile: ChatFileOpenHandler | undefined,
	canOpenFile: ChatFileOpener["canOpenFile"],
) {
	useEffect(() => {
		if (!onOpenFile) return;
		const registeredOpener = { openFile: onOpenFile, canOpenFile };
		opener = registeredOpener;
		emit();
		return () => {
			if (opener === registeredOpener) {
				opener = null;
				emit();
			}
		};
	}, [onOpenFile, canOpenFile]);
}

/** 当前可用的打开动作；没有注册者时为 null。 */
export function useChatFileOpen() {
	return useSyncExternalStore(
		subscribe,
		() => opener,
		() => opener,
	);
}
