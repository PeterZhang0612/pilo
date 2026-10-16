import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";

import type { KeyboardShortcutMap } from "@/lib/keyboard-shortcuts";

export function useDeveloperTools(
	enabled: boolean,
	keyboardShortcuts: KeyboardShortcutMap,
) {
	const { t } = useTranslation();

	useEffect(() => {
		if (!isTauri()) return;

		const hasF12Shortcut = Object.values(keyboardShortcuts).includes("f12");
		const handleKeyDown = (event: KeyboardEvent) => {
			const isF12 =
				event.key === "F12" &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				!event.shiftKey;
			const isInspectorShortcut =
				event.code === "KeyI" &&
				((event.ctrlKey && event.shiftKey) || (event.metaKey && event.altKey));
			if (!isF12 && !isInspectorShortcut) return;
			// Existing bindings and shortcut recording take precedence over DevTools.
			if (
				isF12 &&
				(!enabled ||
					hasF12Shortcut ||
					(event.target instanceof Element &&
						event.target.closest('[data-shortcut-recording="true"]')))
			) {
				return;
			}

			// Capture before Tauri's built-in inspector shortcut bypasses the preference.
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!enabled || event.repeat || event.isComposing) return;

			void invoke<void>("desktop_open_devtools").catch((error: unknown) => {
				console.error("Failed to open developer tools", error);
				toast.error(t("settings.openDeveloperToolsFailed"));
			});
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [enabled, keyboardShortcuts, t]);
}
