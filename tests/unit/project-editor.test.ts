import assert from "node:assert/strict";
import test from "node:test";

import {
	PROJECT_EDITORS,
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
