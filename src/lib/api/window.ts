import { isTauri } from "@tauri-apps/api/core";
import {
	LogicalPosition,
	PhysicalPosition,
	PhysicalSize,
} from "@tauri-apps/api/dpi";
import {
	currentMonitor,
	getCurrentWindow,
	primaryMonitor,
	type WindowOptions,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type NewWindowSessionTarget = {
	sessionId: string;
	projectId: string;
	sessionPath: string;
	title: string;
};

// Windows：与主窗口一致，移除原生装饰、改用前端自绘标题栏（见 src-tauri/src/lib.rs）。
const IS_WINDOWS = isTauri() && navigator.userAgent.includes("Windows");

/** 新窗口按此参数在启动时定位会话（见 App.tsx 的 boot 读取）。 */
export function sessionWindowLabel(sessionId: string): string {
	return `session-${sessionId}`.replace(/[^a-zA-Z0-9\-/:_]/g, "-");
}

/**
 * 当前窗口是否由 openSessionInNewWindow 创建。
 * 以窗口 label 判定（不依赖 URL 是否保留下 query），供布局分支使用。
 */
export function isSessionWindow(): boolean {
	if (!isTauri()) return false;
	return getCurrentWindow().label.startsWith("session-");
}

/** 读取当前窗口 URL 上的会话定位参数（非新窗口场景返回 null）。 */
export function readSessionWindowTarget(): NewWindowSessionTarget | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	const sessionId = params.get("session");
	const projectId = params.get("project");
	if (!sessionId || !projectId) return null;
	return {
		sessionId,
		projectId,
		sessionPath: params.get("path") ?? "",
		title: params.get("title") ?? "",
	};
}

/**
 * 在独立窗口中打开同一个会话。已存在同会话窗口时只聚焦，不重复创建。
 * 返回是否已由 Tauri 处理（非桌面环境返回 false，调用方可忽略）。
 */
export function openSessionInNewWindow(
	target: NewWindowSessionTarget,
): boolean {
	if (!isTauri()) return false;
	const label = sessionWindowLabel(target.sessionId);
	void WebviewWindow.getByLabel(label)
		.then(async (existing) => {
			if (existing) {
				await existing.show();
				await existing.unminimize();
				await existing.setFocus();
				return;
			}
			let bounds: Pick<
				WindowOptions,
				"width" | "height" | "minWidth" | "minHeight" | "center"
			> = {
				width: 480,
				height: 900,
				minWidth: 360,
				minHeight: 420,
				center: true,
			};
			let physicalBounds: {
				position: PhysicalPosition;
				size: PhysicalSize;
			} | null = null;
			try {
				const monitor = (await currentMonitor()) ?? (await primaryMonitor());
				if (monitor) {
					const area =
						monitor.workArea.size.width > 0 && monitor.workArea.size.height > 0
							? monitor.workArea
							: monitor;
					const size = area.size.toLogical(monitor.scaleFactor);
					const width = Math.min(480, Math.floor(size.width * 0.9));
					const height = Math.min(900, Math.floor(size.height * 0.9));
					bounds = {
						width,
						height,
						minWidth: Math.min(360, width),
						minHeight: Math.min(420, height),
						center: true,
					};
					const physicalSize = new PhysicalSize(
						Math.round(width * monitor.scaleFactor),
						Math.round(height * monitor.scaleFactor),
					);
					physicalBounds = {
						size: physicalSize,
						position: new PhysicalPosition(
							area.position.x +
								Math.floor((area.size.width - physicalSize.width) / 2),
							area.position.y +
								Math.floor((area.size.height - physicalSize.height) / 2),
						),
					};
				}
			} catch (error) {
				console.warn("Failed to determine session window work area", error);
			}
			const params = new URLSearchParams({
				session: target.sessionId,
				project: target.projectId,
				path: target.sessionPath,
				title: target.title,
			});
			const sessionWindow = new WebviewWindow(label, {
				url: `index.html?${params.toString()}`,
				title: target.title,
				// 保持窄长，但限制在当前窗口所在屏幕的工作区内。
				...bounds,
				visible: false,
				// 与主窗口（tauri.conf.json）保持一致：
				// macOS 保留原生红绿灯并用 Overlay 让内容延伸至顶栏；
				// Windows 移除原生装饰，交给前端自绘标题栏。
				...(IS_WINDOWS
					? {
							decorations: false,
							shadow: true,
							// Match the main window: only the gated shortcut opens DevTools.
							devtools: false,
						}
					: {
							hiddenTitle: true,
							titleBarStyle: "overlay" as const,
							trafficLightPosition: new LogicalPosition(20, 25),
						}),
			});
			void sessionWindow.once("tauri://created", () => {
				void (async () => {
					if (physicalBounds) {
						try {
							// Global logical coordinates are ambiguous across mixed-DPI screens.
							await sessionWindow.setPosition(physicalBounds.position);
							await sessionWindow.setSize(physicalBounds.size);
						} catch (error) {
							console.warn("Failed to position session window", error);
						}
					}
					await sessionWindow.show();
					await sessionWindow.setFocus();
				})().catch((error) => {
					console.error("Failed to show session window", error);
				});
			});
			void sessionWindow.once("tauri://error", (event) => {
				console.error("Failed to open session window", event);
			});
		})
		.catch((error) => {
			console.error("Failed to open session window", error);
		});
	return true;
}
