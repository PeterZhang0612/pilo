import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_KEYBOARD_SHORTCUTS } from "../../src/lib/keyboard-shortcuts.ts";

import {
	DEFAULT_DESKTOP_SHORTCUT,
	desktopShortcutFromKeyboardEvent,
	getDesktopAutostart,
	getDesktopShortcut,
	hasDesktopShortcutConflict,
	isAutostartMode,
	setDesktopAutostart,
	setDesktopShortcut,
	type AutostartMode,
} from "../../src/lib/desktop-integration.ts";

test("desktop startup IPC preserves modes and propagates OS failures", async (t) => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	let mode: AutostartMode = "disabled";
	let fail = false;
	const calls: Array<{ command: string; args: unknown }> = [];
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				invoke: async (command: string, args?: { mode: AutostartMode }) => {
					calls.push({ command, args });
					if (fail) throw new Error("permission denied");
					if (command === "desktop_autostart_set" && args) mode = args.mode;
					return mode;
				},
			},
		},
	});
	t.after(() => {
		if (originalWindow)
			Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});

	assert.equal(await getDesktopAutostart(), "disabled");
	assert.equal(calls[0].command, "desktop_autostart_get");
	const modes = ["window", "tray", "disabled"] as const;
	assert.equal(modes.every(isAutostartMode), true);
	assert.deepEqual(await Promise.all(modes.map(setDesktopAutostart)), modes);
	assert.deepEqual(
		calls.slice(1),
		modes.map((next) => ({
			command: "desktop_autostart_set",
			args: { mode: next },
		})),
	);
	for (const invalid of ["silent", "enabled", "", "TRAY"]) {
		assert.equal(isAutostartMode(invalid), false);
	}
	fail = true;
	await assert.rejects(setDesktopAutostart("tray"), /permission denied/);
	assert.equal(mode, "disabled");
	await assert.rejects(getDesktopAutostart(), /permission denied/);
});

test("custom desktop shortcut IPC saves only on success and refreshes the tray hint", async (t) => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	let settings = { shortcut: DEFAULT_DESKTOP_SHORTCUT, registered: false };
	let fail = false;
	const calls: Array<{ command: string; args: unknown }> = [];
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				invoke: async (command: string, args?: { shortcut: string }) => {
					calls.push({ command, args });
					if (command === "desktop_tray_set_labels") return;
					if (fail) throw new Error("shortcut occupied");
					if (command === "desktop_shortcut_set" && args)
						settings = { shortcut: args.shortcut, registered: true };
					return settings;
				},
			},
		},
	});
	t.after(() => {
		if (originalWindow)
			Object.defineProperty(globalThis, "window", originalWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});
	assert.deepEqual(await getDesktopShortcut(), {
		shortcut: "mod+alt+p",
		registered: false,
	});
	assert.deepEqual(await setDesktopShortcut("mod+shift+o"), {
		shortcut: "mod+shift+o",
		registered: true,
	});
	assert.deepEqual(
		calls.map((call) => call.command),
		["desktop_shortcut_get", "desktop_shortcut_set", "desktop_tray_set_labels"],
	);
	assert.deepEqual(calls[1].args, { shortcut: "mod+shift+o" });
	fail = true;
	await assert.rejects(setDesktopShortcut("mod+alt+n"), /occupied/);
	assert.equal(settings.shortcut, "mod+shift+o");
	assert.equal(
		calls.filter((call) => call.command === "desktop_tray_set_labels").length,
		1,
	);
	await assert.rejects(getDesktopShortcut(), /occupied/);
});

test("desktop shortcut recording follows native keys with Option and non-Latin layouts", (t) => {
	const originalNavigator = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator",
	);
	t.after(() => {
		if (originalNavigator)
			Object.defineProperty(globalThis, "navigator", originalNavigator);
		else Reflect.deleteProperty(globalThis, "navigator");
	});
	for (const mac of [false, true]) {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { platform: mac ? "MacIntel" : "Win32" },
		});
		const modifiers = {
			ctrlKey: !mac,
			metaKey: mac,
			altKey: true,
			shiftKey: false,
		};
		for (const key of ["p", "π", "з"]) {
			assert.equal(
				desktopShortcutFromKeyboardEvent({
					...modifiers,
					key,
					code: "KeyP",
					keyCode: 0x50,
				}),
				"mod+alt+p",
			);
		}
		assert.equal(
			desktopShortcutFromKeyboardEvent({
				...modifiers,
				key: "!",
				code: "Digit1",
				keyCode: 0x31,
				shiftKey: true,
			}),
			"mod+alt+shift+1",
		);
		assert.equal(
			desktopShortcutFromKeyboardEvent({
				...modifiers,
				key: "+",
				code: "Equal",
				keyCode: 0xbb,
				shiftKey: true,
			}),
			"mod+alt+shift+=",
		);
		assert.equal(
			desktopShortcutFromKeyboardEvent({
				...modifiers,
				key: "Control",
				code: "ControlLeft",
				keyCode: 0x11,
			}),
			null,
		);
		for (const [key, code, keyCode, native] of [
			["z", "KeyY", 0x5a, "z"], // QWERTZ
			["a", "KeyQ", 0x41, "a"], // AZERTY letters
			[",", "KeyM", 0xbc, ","], // AZERTY punctuation on a letter position
			["é", "Digit2", 0x32, "2"], // AZERTY unshifted digit
			["й", "KeyQ", 0x51, "q"], // Cyrillic VK stays Latin
		] as const) {
			const physical = code.slice(code.startsWith("Key") ? 3 : 5).toLowerCase();
			assert.equal(
				desktopShortcutFromKeyboardEvent({ ...modifiers, key, code, keyCode }),
				`mod+alt+${mac ? physical : native}`,
			);
		}
		assert.equal(
			desktopShortcutFromKeyboardEvent({
				...modifiers,
				key: "F2",
				code: "F2",
				keyCode: 0x71,
			}),
			"mod+alt+f2",
		);
	}
});

test("desktop conflict checks cover edits and single/all defaults using the current saved binding", async (t) => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const originalTauri = Object.getOwnPropertyDescriptor(globalThis, "isTauri");
	const originalNavigator = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator",
	);
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { platform: "Win32" },
	});
	let shortcut = "mod+n";
	let fail = false;
	let reads = 0;
	Object.defineProperty(globalThis, "isTauri", {
		configurable: true,
		value: true,
	});
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			__TAURI_INTERNALS__: {
				invoke: async (command: string) => {
					assert.equal(command, "desktop_shortcut_get");
					reads++;
					if (fail) throw new Error("read failed");
					return { shortcut, registered: false };
				},
			},
		},
	});
	t.after(() => {
		for (const [key, descriptor] of [
			["window", originalWindow],
			["isTauri", originalTauri],
			["navigator", originalNavigator],
		] as const) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});

	assert.equal(await hasDesktopShortcutConflict(["mod+shift+o"]), false);
	assert.equal(await hasDesktopShortcutConflict(["ctrl+n"]), true);
	assert.equal(
		await hasDesktopShortcutConflict([DEFAULT_KEYBOARD_SHORTCUTS["new-chat"]]),
		true,
	);
	assert.equal(
		await hasDesktopShortcutConflict(Object.values(DEFAULT_KEYBOARD_SHORTCUTS)),
		true,
	);
	shortcut = "mod+alt+p";
	assert.equal(
		await hasDesktopShortcutConflict(Object.values(DEFAULT_KEYBOARD_SHORTCUTS)),
		false,
	);
	fail = true;
	await assert.rejects(hasDesktopShortcutConflict(["mod+n"]), /read failed/);
	const desktopReads = reads;
	Object.defineProperty(globalThis, "isTauri", {
		configurable: true,
		value: false,
	});
	assert.equal(await hasDesktopShortcutConflict(["mod+n"]), false);
	assert.equal(reads, desktopReads, "WebUI must not call desktop IPC");
});
