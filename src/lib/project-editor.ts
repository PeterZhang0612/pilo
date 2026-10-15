import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Project } from "@/lib/projects";

export const PROJECT_EDITORS = [
	{ id: "zed", name: "Zed" },
	{ id: "vscode", name: "VS Code" },
	{ id: "cursor", name: "Cursor" },
] as const;

export type ProjectEditor = (typeof PROJECT_EDITORS)[number]["id"];

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

export function projectEditorUrl(
	project: Pick<Project, "path" | "connection">,
	editor: ProjectEditor,
): string {
	const kind = project.connection.kind;
	const windowsPath =
		kind.type === "local" && /^(?:[a-z]:[\\/]|\\\\)/i.test(project.path);
	const path = windowsPath
		? project.path
				.replace(/\\/g, "/")
				.replace(/^\/\/\?\/UNC\//i, "//")
				.replace(/^\/\/\?\//, "")
		: project.path;
	const rootedPath = path.startsWith("/") ? path : `/${path}`;

	if (kind.type === "ssh") {
		const target = kind.target;
		const host = target.type === "config_host" ? target.host : target.hostname;
		if (editor === "zed") {
			const hostname =
				host.includes(":") && !host.startsWith("[")
					? `[${host}]`
					: encodeURIComponent(host)
							.replace(/%3A/gi, ":")
							.replace(/%5B/gi, "[")
							.replace(/%5D/gi, "]");
			const user =
				target.type === "direct" && target.user
					? `${encodeURIComponent(target.user)}@`
					: "";
			const port =
				target.type === "direct" && target.port ? `:${target.port}` : "";
			return `zed://ssh/${user}${hostname}${port}${encodePath(rootedPath)}`;
		}
		// Remote-SSH accepts a UTF-8 hex JSON authority, preserving user and port.
		const authority = JSON.stringify({
			hostName: host,
			...(target.type === "direct" && target.user ? { user: target.user } : {}),
			...(target.type === "direct" && target.port ? { port: target.port } : {}),
		});
		const encodedAuthority = Array.from(
			new TextEncoder().encode(authority),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join("");
		return `${editor}://vscode-remote/ssh-remote+${encodedAuthority}${encodePath(rootedPath)}`;
	}

	if (kind.type === "wsl") {
		if (editor === "zed") {
			return `zed://file//wsl.localhost/${encodeURIComponent(kind.distro)}${encodePath(rootedPath)}`;
		}
		return `${editor}://vscode-remote/wsl+${encodeURIComponent(kind.distro)}${encodePath(rootedPath)}`;
	}

	// Zed strips "zed://file" literally; Windows drive paths must not gain a slash.
	if (editor === "zed") return `zed://file${encodePath(path)}`;
	return `${editor}://file${encodePath(rootedPath)}`;
}

export async function openProjectInEditor(
	project: Pick<Project, "id" | "path" | "connection">,
	editor: ProjectEditor,
): Promise<void> {
	if (
		isTauri() &&
		navigator.userAgent.includes("Windows") &&
		editor === "zed" &&
		project.connection.kind.type === "wsl"
	) {
		await invoke<void>("project_open_in_zed_wsl", { id: project.id });
		return;
	}

	const url = projectEditorUrl(project, editor);
	if (isTauri()) {
		await openUrl(url);
	} else {
		// Keep this synchronous with the menu selection for browser user activation.
		window.location.assign(url);
	}
}
