import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { i18n } from "@/i18n";
import {
	normalizeKeyboardShortcut,
	shortcutFromKeyboardEvent,
} from "@/lib/keyboard-shortcuts";

export const isDesktopIntegrationAvailable = isTauri;
export const DEFAULT_DESKTOP_SHORTCUT = "mod+alt+p";

export interface DesktopShortcutSettings {
	shortcut: string;
	registered: boolean;
}

export function desktopShortcutFromKeyboardEvent(
	event: Pick<
		KeyboardEvent,
		"key" | "code" | "keyCode" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
	>,
) {
	// macOS uses physical keys, including with Option or non-Latin layouts.
	const punctuation: Record<string, string> = {
		Backquote: "`",
		Backslash: "\\",
		BracketLeft: "[",
		BracketRight: "]",
		Comma: ",",
		Equal: "=",
		Minus: "-",
		Period: ".",
		Quote: "'",
		Semicolon: ";",
		Slash: "/",
	};
	let key = /^Key[A-Z]$/.test(event.code)
		? event.code.slice(3)
		: /^Digit[0-9]$/.test(event.code)
			? event.code.slice(5)
			: (punctuation[event.code] ?? event.key);
	if (typeof navigator !== "undefined" && /Win/.test(navigator.platform)) {
		// Windows WebView2 exposes VK codes via keyCode, unlike physical `code`.
		const vk = event.keyCode;
		const oemKeys: Record<number, string> = {
			0xba: ";",
			0xbb: "=",
			0xbc: ",",
			0xbd: "-",
			0xbe: ".",
			0xbf: "/",
			0xc0: "`",
			0xdb: "[",
			0xdc: "\\",
			0xdd: "]",
			0xde: "'",
		};
		const printableKey =
			(vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)
				? String.fromCharCode(vk)
				: oemKeys[vk];
		// Do not turn an unknown printable VK into a different native key.
		if (!printableKey && event.key.length === 1 && event.key !== " ")
			return null;
		key = printableKey ?? event.key;
	}
	return shortcutFromKeyboardEvent({
		key,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
	});
}

export function getDesktopShortcut() {
	return invoke<DesktopShortcutSettings>("desktop_shortcut_get");
}

export async function hasDesktopShortcutConflict(shortcuts: readonly string[]) {
	if (!isDesktopIntegrationAvailable()) return false;
	const { shortcut } = await getDesktopShortcut();
	const normalized = normalizeKeyboardShortcut(shortcut);
	return (
		normalized !== null &&
		shortcuts.some((value) => normalizeKeyboardShortcut(value) === normalized)
	);
}

export async function setDesktopShortcut(shortcut: string) {
	const settings = await invoke<DesktopShortcutSettings>(
		"desktop_shortcut_set",
		{ shortcut },
	);
	updateTrayLabels();
	return settings;
}

export type AutostartMode = "disabled" | "window" | "tray";

export function isAutostartMode(value: string): value is AutostartMode {
	return value === "disabled" || value === "window" || value === "tray";
}

export function getDesktopAutostart() {
	return invoke<AutostartMode>("desktop_autostart_get");
}

export function setDesktopAutostart(mode: AutostartMode) {
	return invoke<AutostartMode>("desktop_autostart_set", { mode });
}

export function getDesktopExitOnClose() {
	return invoke<boolean>("desktop_exit_on_close_get");
}

export function setDesktopExitOnClose(enabled: boolean) {
	return invoke<boolean>("desktop_exit_on_close_set", { enabled });
}

function updateTrayLabels() {
	void invoke<void>("desktop_tray_set_labels", {
		labels: {
			show: i18n.t("desktop.show"),
			hide: i18n.t("desktop.hide"),
			quit: i18n.t("desktop.quit"),
		},
	}).catch((error) => console.error("Failed to update tray labels", error));
}

export function installDesktopTrayLabels() {
	if (getCurrentWindow().label !== "main") return;
	updateTrayLabels();
	i18n.on("languageChanged", updateTrayLabels);
}
