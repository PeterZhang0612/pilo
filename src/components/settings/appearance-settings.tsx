import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import {
	UI_FONT_SIZE_RANGE,
	READING_FONT_SIZE_RANGE,
	CODE_FONT_SIZE_RANGE,
	TERMINAL_FONT_SIZE_RANGE,
	MONOSPACE_FONT_BUILTIN_OPTIONS,
	PAGE_FONT_BUILTIN_OPTIONS,
	buildSystemFontOptions,
	filterSymbolFontFamilies,
	getPageFontFamilyStack,
	getMonospaceFontFamilyStack,
	resolveSystemFontFamilies,
	resolveSystemMonospaceFamilies,
} from "@/lib/font-settings";
import { usePreferences } from "@/lib/preferences-provider";
import { useTheme, type Theme } from "@/lib/theme-provider";
import { cn } from "@/lib/utils";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/ui";
import {
	SETTINGS_CONTAINER_CLASS,
	SETTINGS_CONTROL_CLASS,
	SettingsRow,
	SettingsSection,
} from "./compact-layout";
import { FontSelect, type FontSelectGroup } from "./font-select";
import { FontSizeInput } from "./font-size-input";

const THEME_LABEL_KEYS: Record<
	Theme,
	"settings.light" | "settings.dark" | "settings.system"
> = {
	light: "settings.light",
	dark: "settings.dark",
	system: "settings.system",
};

const FONT_SETTINGS_ROW_CLASS =
	"sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] " +
	"[&>div:last-child]:grid [&>div:last-child]:w-full [&>div:last-child]:max-w-[20rem] " +
	"[&>div:last-child]:grid-cols-[minmax(0,1fr)_5.5rem] " +
	"sm:[&>div:last-child]:justify-self-end sm:[&>div:last-child]:pl-0 " +
	"max-sm:[&>div:last-child>button]:ml-0!";
const FONT_SELECT_CLASS = "min-w-0 w-full pointer-coarse:h-11";

export function AppearanceSettings() {
	const { t } = useTranslation();
	const { theme, setTheme } = useTheme();
	const {
		pageFontFamily,
		setPageFontFamily,
		uiFontSize,
		setUiFontSize,
		readingFontFamily,
		setReadingFontFamily,
		readingFontSize,
		setReadingFontSize,
		resetFontFamilies,
		resetFontSizes,
		codeFontFamily,
		setCodeFontFamily,
		codeFontSize,
		setCodeFontSize,
		terminalFontFamily,
		setTerminalFontFamily,
		terminalFontSize,
		setTerminalFontSize,
	} = usePreferences();
	const [systemPageFonts, setSystemPageFonts] = useState<readonly string[]>([]);
	const [systemMonospaceFonts, setSystemMonospaceFonts] = useState<
		readonly string[]
	>([]);

	useEffect(() => {
		let cancelled = false;
		void resolveSystemFontFamilies().then((families) => {
			if (!cancelled) setSystemPageFonts(filterSymbolFontFamilies(families));
		});
		void resolveSystemMonospaceFamilies().then((families) => {
			if (!cancelled) setSystemMonospaceFonts(families);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const pageFontGroups: FontSelectGroup[] = [
		{ label: t("settings.builtIn"), options: PAGE_FONT_BUILTIN_OPTIONS },
		{
			label: t("settings.systemFonts"),
			options: buildSystemFontOptions(systemPageFonts),
		},
	];
	const monospaceFontGroups: FontSelectGroup[] = [
		{ label: t("settings.builtIn"), options: MONOSPACE_FONT_BUILTIN_OPTIONS },
		{
			label: t("settings.systemMonospace"),
			options: buildSystemFontOptions(systemMonospaceFonts),
		},
	];

	return (
		<div className={SETTINGS_CONTAINER_CLASS}>
			<SettingsSection>
				<SettingsRow label={t("settings.theme")}>
					<Select
						value={theme}
						onValueChange={(value) => setTheme(value as Theme)}
					>
						<SelectTrigger className={cn(SETTINGS_CONTROL_CLASS, "w-[220px]")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(THEME_LABEL_KEYS) as Theme[]).map((value) => (
								<SelectItem key={value} value={value}>
									{t(THEME_LABEL_KEYS[value])}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
			</SettingsSection>

			<SettingsSection
				title={t("settings.font")}
				headerRight={
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="pointer-coarse:min-h-[44px]"
							>
								{t("settings.resetDefault")}
								<ChevronDown className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onSelect={resetFontFamilies}
								className="pointer-coarse:min-h-[44px]"
							>
								{t("settings.resetFonts")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={resetFontSizes}
								className="pointer-coarse:min-h-[44px]"
							>
								{t("settings.resetFontSizes")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			>
				<SettingsRow
					label={t("settings.pageFont")}
					className={FONT_SETTINGS_ROW_CLASS}
				>
					<FontSelect
						value={pageFontFamily}
						groups={pageFontGroups}
						onChange={setPageFontFamily}
						className={FONT_SELECT_CLASS}
					/>
					<FontSizeInput
						value={uiFontSize}
						{...UI_FONT_SIZE_RANGE}
						label={t("settings.pageFont")}
						onChange={setUiFontSize}
					/>
				</SettingsRow>

				<SettingsRow
					label={t("settings.readingFont")}
					helper={t("settings.readingFontDescription")}
					className={FONT_SETTINGS_ROW_CLASS}
				>
					<FontSelect
						value={readingFontFamily}
						groups={pageFontGroups}
						onChange={setReadingFontFamily}
						className={FONT_SELECT_CLASS}
					/>
					<FontSizeInput
						value={readingFontSize}
						{...READING_FONT_SIZE_RANGE}
						label={t("settings.readingFont")}
						onChange={setReadingFontSize}
					/>
				</SettingsRow>

				<SettingsRow
					label={t("settings.codeFont")}
					className={FONT_SETTINGS_ROW_CLASS}
				>
					<FontSelect
						value={codeFontFamily}
						groups={monospaceFontGroups}
						onChange={setCodeFontFamily}
						className={cn(FONT_SELECT_CLASS, "font-mono")}
					/>
					<FontSizeInput
						value={codeFontSize}
						{...CODE_FONT_SIZE_RANGE}
						label={t("settings.codeFont")}
						onChange={setCodeFontSize}
					/>
				</SettingsRow>

				<SettingsRow
					label={t("settings.terminalFont")}
					className={FONT_SETTINGS_ROW_CLASS}
				>
					<FontSelect
						value={terminalFontFamily}
						groups={monospaceFontGroups}
						onChange={setTerminalFontFamily}
						className={cn(FONT_SELECT_CLASS, "font-mono")}
					/>
					<FontSizeInput
						value={terminalFontSize}
						{...TERMINAL_FONT_SIZE_RANGE}
						label={t("settings.terminalFont")}
						onChange={setTerminalFontSize}
					/>
				</SettingsRow>
			</SettingsSection>

			<SettingsSection title={t("settings.fontPreview")}>
				<div className="divide-y divide-border/60">
					{[
						{
							label: t("settings.pageFont"),
							content: (
								<div
									className="space-y-1.5 rounded-md border border-border/60 bg-background p-3"
									style={{ fontFamily: getPageFontFamilyStack(pageFontFamily) }}
								>
									<p className="text-sm font-medium">{t("settings.title")}</p>
									<p className="text-xs leading-[1.45] text-muted-foreground">
										{t("settings.fontPreviewText")}
									</p>
								</div>
							),
						},
						{
							label: t("settings.readingFont"),
							content: (
								<div
									className="space-y-2 leading-[1.75] [overflow-wrap:anywhere]"
									style={{
										fontFamily: getPageFontFamilyStack(readingFontFamily),
										fontSize: `${readingFontSize}px`,
									}}
								>
									<p className="font-semibold">
										{t("settings.fontPreviewHeading")}
									</p>
									<p>{t("settings.fontPreviewReadingText")}</p>
									<p>{t("settings.fontPreviewText")}</p>
								</div>
							),
						},
						{
							label: t("settings.codeFont"),
							content: (
								<div className="overflow-hidden rounded-md border border-code-border bg-code text-code-foreground">
									<div className="border-b border-code-border px-3 py-1.5 text-2xs text-muted-foreground">
										TypeScript
									</div>
									<pre
										className="overflow-x-auto p-3 leading-[1.4]"
										style={{
											fontFamily: getMonospaceFontFamilyStack(codeFontFamily),
											fontSize: `${codeFontSize}px`,
										}}
									>
										<code style={{ fontFamily: "inherit" }}>
											<span className="text-syntax-keyword">const</span>
											{" message = "}
											<span className="text-syntax-string">
												{'"Hello, 你好！"'}
											</span>
											{";\n"}
											<span className="text-syntax-keyword">const</span>
											{" count = "}
											<span className="text-syntax-number">12345</span>
											{";\n"}
											<span className="text-syntax-function">console.log</span>
											{"(message, count);"}
										</code>
									</pre>
								</div>
							),
						},
						{
							label: t("settings.terminalFont"),
							content: (
								<pre
									className="overflow-x-auto rounded-md border border-border/60 bg-background p-3 leading-[1.15] text-foreground"
									style={{
										fontFamily: getMonospaceFontFamilyStack(terminalFontFamily),
										fontSize: `${terminalFontSize}px`,
									}}
								>
									<span className="text-muted-foreground">~/pilo</span>
									{' $ echo "Hello, 你好！ 0123456789"\n'}
									{"Hello, 你好！ 0123456789\n"}
									<span className="text-muted-foreground">~/pilo</span>
									{" $ "}
									<span
										aria-hidden="true"
										className="inline-block h-[1em] w-[0.6em] bg-foreground align-text-bottom"
									/>
								</pre>
							),
						},
					].map((preview) => (
						<div
							key={preview.label}
							className="grid min-w-0 items-start gap-2 px-3 py-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"
						>
							<p className="pt-1 text-xs text-muted-foreground">
								{preview.label}
							</p>
							<div className="min-w-0">{preview.content}</div>
						</div>
					))}
				</div>
			</SettingsSection>
		</div>
	);
}
