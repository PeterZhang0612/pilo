import {
	isThemeCustomCss,
	readSavedCustomThemes,
	type SavedCustomTheme,
} from "@/lib/theme-custom";

export type Theme = "dark" | "light" | "system";
export type ThemeFamily = "lody" | "claude" | "custom";

export type ThemeSettings = {
	revision: number;
	theme: Theme;
	themeFamily: ThemeFamily;
	themeCustomCss: string;
	themeCustomName: string;
	savedCustomThemes: SavedCustomTheme[];
};

export type ThemeSettingsUpdate = Partial<
	Pick<
		ThemeSettings,
		"theme" | "themeFamily" | "themeCustomCss" | "themeCustomName"
	>
> & {
	saveCustomTheme?: SavedCustomTheme;
	deleteCustomTheme?: string;
};

export const THEME_CACHE_KEY = "pilo.theme.v1";

// Only a startup cache / one-time desktop migration source; SQLite is authoritative.
export function readCachedTheme(
	defaultTheme: Theme,
	storageKey = "pilo-ui-theme",
	familyStorageKey = "pilo-ui-theme-family",
): ThemeSettings {
	let stored: Record<string, unknown> = {};
	try {
		const raw: unknown = JSON.parse(
			localStorage.getItem(THEME_CACHE_KEY) ??
				localStorage.getItem("pilo.preferences.v1") ??
				"{}",
		);
		if (raw && typeof raw === "object" && !Array.isArray(raw))
			stored = raw as Record<string, unknown>;
		const theme = localStorage.getItem(storageKey);
		const family = localStorage.getItem(familyStorageKey);
		stored = {
			...stored,
			theme: stored.theme ?? theme,
			themeFamily: stored.themeFamily ?? family,
		};
	} catch {
		// Storage may be unavailable; the Host snapshot will still load.
	}
	return {
		revision: 0,
		theme:
			stored.theme === "light" ||
			stored.theme === "dark" ||
			stored.theme === "system"
				? stored.theme
				: defaultTheme,
		themeFamily:
			stored.themeFamily === "claude" || stored.themeFamily === "custom"
				? stored.themeFamily
				: "lody",
		themeCustomCss: isThemeCustomCss(stored.themeCustomCss)
			? stored.themeCustomCss
			: "",
		themeCustomName:
			typeof stored.themeCustomName === "string" ? stored.themeCustomName : "",
		savedCustomThemes: readSavedCustomThemes(stored.savedCustomThemes),
	};
}
