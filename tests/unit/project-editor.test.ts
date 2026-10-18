import assert from "node:assert/strict";
import test from "node:test";

import {
	PROJECT_EDITORS,
	openProjectInEditor,
	projectEditorUrl,
	readProjectEditor,
	subscribeProjectEditor,
	writeProjectEditor,
} from "../../src/lib/project-editor.ts";

test("remembers the selected editor and falls back to Zed for invalid storage", (t) => {
	const storage = new Map<string, string>();
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
			},
		},
	});
	t.after(() => {
		t.mock.restoreAll();
		writeProjectEditor("zed");
		if (originalWindow) {
			Object.defineProperty(globalThis, "window", originalWindow);
		} else {
			Reflect.deleteProperty(globalThis, "window");
		}
	});

	assert.equal(readProjectEditor().id, "zed");
	for (const editor of PROJECT_EDITORS) {
		writeProjectEditor(editor.id);
		assert.equal(readProjectEditor(), editor);
	}
	assert.equal(storage.size, 1);
	const [key] = storage.keys();
	storage.set(key, "unknown-editor");
	assert.equal(readProjectEditor().id, "zed");
	storage.set(key, "");
	assert.equal(readProjectEditor().id, "zed");

	t.mock.method(window.localStorage, "getItem", () => {
		throw new Error("Storage unavailable");
	});
	t.mock.method(window.localStorage, "setItem", () => {
		throw new Error("Storage unavailable");
	});
	assert.equal(readProjectEditor().id, "zed");
	assert.doesNotThrow(() => writeProjectEditor("cursor"));
	assert.equal(readProjectEditor().id, "cursor");
});

test("editor preferences are safe without a browser window", () => {
	assert.equal(typeof window, "undefined");
	assert.equal(readProjectEditor().id, "zed");
	assert.doesNotThrow(() => writeProjectEditor("cursor"));
	assert.doesNotThrow(() => subscribeProjectEditor(() => {})());
});

test("mounted menus share editor changes and unsubscribe cleanly", (t) => {
	const storage = new Map<string, string>();
	const target = new EventTarget();
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: Object.assign(target, {
			localStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
			},
		}),
	});
	let menuA = readProjectEditor();
	let menuB = readProjectEditor();
	const unsubscribeA = subscribeProjectEditor(() => {
		menuA = readProjectEditor();
	});
	const unsubscribeB = subscribeProjectEditor(() => {
		menuB = readProjectEditor();
	});
	t.after(() => {
		unsubscribeA();
		unsubscribeB();
		t.mock.restoreAll();
		writeProjectEditor("zed");
		if (originalWindow) {
			Object.defineProperty(globalThis, "window", originalWindow);
		} else {
			Reflect.deleteProperty(globalThis, "window");
		}
	});

	writeProjectEditor("cursor");
	assert.equal(menuA.id, "cursor");
	assert.equal(menuB.id, "cursor");
	// Opening the previously mounted menu must not restore its old Zed choice.
	writeProjectEditor(menuB.id);
	assert.equal(readProjectEditor().id, "cursor");

	const [key] = storage.keys();
	storage.set(key, "vscode");
	target.dispatchEvent(Object.assign(new Event("storage"), { key }));
	assert.equal(menuA.id, "vscode");
	assert.equal(menuB.id, "vscode");

	storage.clear();
	target.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
	assert.equal(menuA.id, "zed");
	assert.equal(menuB.id, "zed");

	unsubscribeB();
	writeProjectEditor("cursor");
	assert.equal(menuA.id, "cursor");
	assert.equal(menuB.id, "zed");
	storage.set(key, "vscode");
	target.dispatchEvent(Object.assign(new Event("storage"), { key }));
	assert.equal(menuA.id, "vscode");
	assert.equal(menuB.id, "zed");

	t.mock.method(window.localStorage, "setItem", () => {
		throw new Error("Storage unavailable");
	});
	writeProjectEditor("cursor");
	assert.equal(menuA.id, "cursor");
	assert.equal(readProjectEditor().id, "cursor");
});

test("editor URLs target the selected file without losing connection or path encoding", () => {
	const local = {
		path: "C:\\work\\repo",
		connection: {
			id: "local",
			name: "Local",
			kind: { type: "local" as const },
		},
	};
	const file = "\\\\?\\C:\\work\\repo\\docs\\说明 #1.md";
	for (const editor of PROJECT_EDITORS) {
		const prefix = editor.id === "zed" ? "zed://file" : `${editor.id}://file/`;
		assert.equal(
			decodeURIComponent(projectEditorUrl(local, editor.id)),
			`${prefix}C:/work/repo`,
		);
		const url = projectEditorUrl(local, editor.id, file);
		assert.equal(
			decodeURIComponent(url),
			`${prefix}C:/work/repo/docs/说明 #1.md`,
		);
		assert.ok(url.includes("%20%231.md"));
	}
	const remoteFile = "/home/me/repo/docs/说明 #1.md";
	const wsl = {
		path: "/home/me/repo",
		connection: {
			id: "wsl",
			name: "WSL",
			kind: { type: "wsl" as const, distro: "Debian" },
		},
	};
	const ssh = {
		path: "/home/me/repo",
		connection: {
			id: "ssh",
			name: "SSH",
			kind: {
				type: "ssh" as const,
				target: {
					type: "direct" as const,
					hostname: "example.com",
					user: "dev",
					port: 2222,
					authMethod: "agent" as const,
				},
			},
		},
	};
	for (const editor of PROJECT_EDITORS) {
		for (const project of [wsl, ssh]) {
			const rootUrl = projectEditorUrl(project, editor.id);
			const fileUrl = projectEditorUrl(project, editor.id, remoteFile);
			assert.equal(
				fileUrl,
				`${rootUrl}/docs/${encodeURIComponent("说明 #1.md")}`,
			);
		}
	}
});

test("native editor opening forwards the file to URL handlers and the Windows Zed WSL launcher", async (t) => {
	const keys = ["window", "navigator", "isTauri"];
	const originals = keys.map((key) =>
		Object.getOwnPropertyDescriptor(globalThis, key),
	);
	t.after(() => {
		keys.forEach((key, index) => {
			const original = originals[index];
			if (original) Object.defineProperty(globalThis, key, original);
			else Reflect.deleteProperty(globalThis, key);
		});
	});
	const calls: { command: string; args: Record<string, unknown> }[] = [];
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				invoke: async (command: string, args: Record<string, unknown>) => {
					calls.push({ command, args });
				},
			},
		},
	});
	Object.defineProperty(globalThis, "isTauri", {
		configurable: true,
		value: true,
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { userAgent: "Windows" },
	});
	const project = {
		id: "wsl-project",
		path: "/home/me/repo",
		connection: {
			id: "wsl",
			name: "WSL",
			kind: { type: "wsl" as const, distro: "Debian" },
		},
	};
	await openProjectInEditor(project, "zed", "/home/me/repo/main.ts");
	assert.deepEqual(calls.at(-1), {
		command: "project_open_in_zed_wsl",
		args: { id: project.id, path: "/home/me/repo/main.ts" },
	});
	await openProjectInEditor(project, "zed");
	assert.deepEqual(calls.at(-1), {
		command: "project_open_in_zed_wsl",
		args: { id: project.id, path: undefined },
	});
	await openProjectInEditor(project, "vscode", "/home/me/repo/main.ts");
	assert.equal(calls.at(-1)?.command, "plugin:opener|open_url");
	assert.equal(
		calls.at(-1)?.args.url,
		"vscode://vscode-remote/wsl+Debian/home/me/repo/main.ts",
	);
});
