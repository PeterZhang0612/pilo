import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KeyboardShortcutsSettings } from "../../src/components/settings/keyboard-shortcuts-settings.tsx";
import { i18n, initializeI18n } from "../../src/i18n/index.ts";
import { PreferencesProvider } from "../../src/lib/preferences-provider.tsx";
import { TooltipProvider } from "../../src/ui/index.ts";

await initializeI18n("en-US");

function render() {
	return renderToStaticMarkup(
		createElement(
			TooltipProvider,
			null,
			createElement(
				PreferencesProvider,
				null,
				createElement(KeyboardShortcutsSettings),
			),
		),
	);
}

test("global shortcut settings are desktop-only and have accessible controls", (t) => {
	const original = Object.getOwnPropertyDescriptor(globalThis, "isTauri");
	t.after(() => {
		if (original) Object.defineProperty(globalThis, "isTauri", original);
		else Reflect.deleteProperty(globalThis, "isTauri");
	});
	Object.defineProperty(globalThis, "isTauri", {
		configurable: true,
		value: false,
	});
	assert.ok(!render().includes(i18n.t("desktop.shortcutHint")));
	Object.defineProperty(globalThis, "isTauri", {
		configurable: true,
		value: true,
	});
	const desktop = render();
	assert.ok(desktop.includes(i18n.t("desktop.shortcutHint")));
	assert.ok(
		desktop.includes(
			`aria-label="${i18n.t("shortcuts.change", { label: i18n.t("desktop.show") })}"`,
		),
	);
	assert.ok(
		desktop.includes(
			`aria-label="${i18n.t("shortcuts.reset", { label: i18n.t("desktop.show") })}"`,
		),
	);
	assert.match(desktop, /pointer-coarse:min-h-11/);
});
