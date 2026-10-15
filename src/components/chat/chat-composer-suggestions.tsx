import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
	FileCode2,
	MessageSquare,
	Sparkles,
	TerminalSquare,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
	menuItemClassName,
	menuItemIconClassName,
	menuSurfaceClassName,
	menuSurfaceStyle,
} from "@/ui/menu-styles";

export type ComposerSuggestionKind = "file" | "session" | "command";

export type ComposerSuggestion = {
	kind: ComposerSuggestionKind;
	value: string;
	label: string;
	detail?: string;
	/** 标记 /skill:<name> 命令，菜单中用独立图标区分。 */
	skill?: boolean;
};

export type SuggestionTrigger = "@" | "/";

export type ActiveSuggestionQuery = {
	trigger: SuggestionTrigger;
	query: string;
	start: number;
	end: number;
};

export const DEFAULT_SUGGESTIONS: readonly ComposerSuggestion[] = [];
export const FILE_SUGGESTION_LIMIT = 5;

export function piSessionSuggestions(t: TFunction): ComposerSuggestion[] {
	return [
		{
			kind: "command",
			value: "/new",
			label: "/new",
			detail: t("chat.newSessionDetail"),
		},
		{
			kind: "command",
			value: "/compact",
			label: "/compact",
			detail: t("chat.compactContextDetail"),
		},
	];
}

export const TRIGGER_META: Record<
	SuggestionTrigger,
	{
		kind: ComposerSuggestionKind;
		titleKey: "chat.fileSuggestion" | "chat.piCommandSuggestion";
	}
> = {
	"@": { kind: "file", titleKey: "chat.fileSuggestion" },
	"/": { kind: "command", titleKey: "chat.piCommandSuggestion" },
};

export function activeSuggestionQuery(
	value: string,
	caret: number,
): ActiveSuggestionQuery | null {
	const beforeCaret = value.slice(0, caret);
	const tokenStart =
		Math.max(
			beforeCaret.lastIndexOf(" "),
			beforeCaret.lastIndexOf("\n"),
			beforeCaret.lastIndexOf("\t"),
		) + 1;
	const token = beforeCaret.slice(tokenStart);
	const trigger = token[0];
	if (trigger !== "@" && trigger !== "/") return null;
	// 命令仅由输入开头的斜杠触发；@ 文件引用可在任意位置触发。
	if (trigger === "/" && tokenStart !== 0) return null;
	if (token.slice(1).includes(" ")) return null;
	return {
		trigger,
		query: token.slice(1),
		start: tokenStart,
		end: caret,
	};
}

function SuggestionIcon({
	kind,
	skill = false,
}: {
	kind: ComposerSuggestionKind;
	skill?: boolean;
}) {
	if (kind === "file") return <FileCode2 className="size-3" />;
	if (kind === "session") return <MessageSquare className="size-3" />;
	if (skill) return <Sparkles className="size-3" />;
	return <TerminalSquare className="size-3" />;
}

export type MentionTab = "file" | "session";

type ComposerSuggestionMenuProps = {
	menuId: string;
	mentionTab: MentionTab;
	categoryFocused: boolean;
	onMentionTabChange: (tab: MentionTab) => void;
	activeQuery: ActiveSuggestionQuery;
	title: string;
	suggestions: readonly ComposerSuggestion[];
	highlightedIndex: number;
	onHighlight: (index: number) => void;
	onSelect: (suggestion: ComposerSuggestion) => void;
};

export function ComposerSuggestionMenu({
	menuId,
	mentionTab,
	categoryFocused,
	onMentionTabChange,
	activeQuery,
	title,
	suggestions,
	highlightedIndex,
	onHighlight,
	onSelect,
}: ComposerSuggestionMenuProps) {
	const { t } = useTranslation();
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		if (highlightedIndex < 0) {
			list.scrollTop = 0;
			return;
		}
		if (suggestions.length === 0) return;
		const item = list.querySelector<HTMLElement>(
			`[data-suggestion-index="${highlightedIndex}"]`,
		);
		if (!item) return;

		const listRect = list.getBoundingClientRect();
		const itemRect = item.getBoundingClientRect();
		if (itemRect.top < listRect.top) {
			list.scrollTop -= listRect.top - itemRect.top;
		} else if (itemRect.bottom > listRect.bottom) {
			list.scrollTop += itemRect.bottom - listRect.bottom;
		}
	}, [highlightedIndex, suggestions]);

	const listMaxHeight = `min(${activeQuery.trigger === "/" ? "18rem" : "13rem"}, calc(var(--remote-viewport-height, 100dvh) * 0.4))`;

	return (
		<div
			className={cn(
				"absolute bottom-[calc(100%+6px)] left-0 z-40 w-full overflow-hidden",
				menuSurfaceClassName,
				"min-w-0",
				activeQuery.trigger === "/" ? "max-w-[520px]" : "max-w-[600px]",
			)}
			style={menuSurfaceStyle}
		>
			{activeQuery.trigger === "@" ? (
				<div
					role="tablist"
					aria-label={t("chat.mentionCategories")}
					className="mb-1 flex items-center gap-1 px-1 pt-1"
				>
					{(["file", "session"] as const).map((tab) => (
						<button
							key={tab}
							id={`${menuId}-${tab}-tab`}
							type="button"
							role="tab"
							aria-selected={mentionTab === tab}
							aria-controls={`${menuId}-panel`}
							tabIndex={-1}
							className={cn(
								"inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium outline-hidden transition-colors [&>svg]:size-3.5",
								"hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:min-w-11",
								mentionTab === tab
									? "text-foreground"
									: "text-muted-foreground",
								mentionTab === tab && categoryFocused && "bg-muted",
							)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => onMentionTabChange(tab)}
						>
							<SuggestionIcon kind={tab} />
							{t(
								tab === "file"
									? "chat.fileSuggestion"
									: "chat.sessionSuggestion",
							)}
						</button>
					))}
					{categoryFocused ? (
						<span className="ms-auto hidden min-w-0 items-center gap-1.5 ps-2 pe-1 text-2xs text-muted-foreground pointer-fine:inline-flex">
							<kbd className="shrink-0 rounded border border-border/70 bg-muted/50 px-1 py-px font-mono">
								Tab
							</kbd>
							<span className="truncate">{t("chat.mentionTabSwitchHint")}</span>
						</span>
					) : null}
				</div>
			) : null}
			<div
				id={`${menuId}-panel`}
				role={activeQuery.trigger === "@" ? "tabpanel" : undefined}
				aria-labelledby={
					activeQuery.trigger === "@"
						? `${menuId}-${mentionTab}-tab`
						: undefined
				}
			>
				<div
					id={menuId}
					// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The custom list keeps editing focus in the textarea via aria-activedescendant.
					role="listbox"
					aria-label={title}
					ref={listRef}
					className="scrollbar-pro overflow-y-auto overscroll-contain"
					style={{ maxHeight: listMaxHeight }}
				>
					{suggestions.length > 0 ? (
						suggestions.map((suggestion, index) => (
							<button
								key={`${suggestion.kind}:${suggestion.value}`}
								type="button"
								// oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Rich suggestions are activated without moving focus away from the textarea.
								role="option"
								id={`${menuId}-${index}`}
								aria-selected={index === highlightedIndex}
								data-suggestion-index={index}
								tabIndex={-1}
								className={cn(
									menuItemClassName,
									"pointer-coarse:min-h-11",
									index === highlightedIndex &&
										"bg-hover text-hover-foreground",
								)}
								onMouseDown={(event) => event.preventDefault()}
								onPointerMove={(event) => {
									if (event.pointerType === "mouse") onHighlight(index);
								}}
								onClick={() => onSelect(suggestion)}
							>
								<span className={menuItemIconClassName}>
									<SuggestionIcon
										kind={suggestion.kind}
										skill={suggestion.skill}
									/>
								</span>
								<span
									className={cn(
										"min-w-0 flex-1 truncate text-xs",
										suggestion.kind !== "session" && "font-mono",
									)}
								>
									{suggestion.label}
								</span>
								{suggestion.detail ? (
									<span className="min-w-0 max-w-[45%] shrink truncate text-xs text-muted-foreground">
										{suggestion.detail}
									</span>
								) : null}
							</button>
						))
					) : (
						<div className="px-3 py-4 text-center text-xs text-muted-foreground">
							{activeQuery.query
								? t("chat.noSuggestionMatch", {
										query: activeQuery.query,
										title,
									})
								: t("chat.noSuggestionAvailable", { title })}
						</div>
					)}
				</div>
			</div>
			{activeQuery.trigger === "@" ? (
				<output className="sr-only">{title}</output>
			) : null}
		</div>
	);
}
