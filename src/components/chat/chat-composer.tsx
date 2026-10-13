import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";

import { ChatImageThumbnail } from "@/components/chat/chat-image-viewer";

import { formatKeyboardShortcut } from "@/lib/keyboard-shortcuts";
import type { PiModel, PiThinkingLevel } from "@/lib/pi-runtime";
import type { ModelScopeControls } from "@/lib/project-model-scope";
import { cn } from "@/lib/utils";
import { getPageFontFamilyStack } from "@/lib/font-settings";
import { usePreferences } from "@/lib/preferences-provider";
import {
	CHAT_IMAGE_ACCEPT,
	type ChatImageAttachment,
	type ChatSubmission,
} from "@/lib/chat-submission";
import {
	Button,
	NoticeCard,
	Textarea,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/ui";
import { ComposerActions } from "@/components/chat/chat-composer-actions";
import { ComposerContextUsage } from "@/components/chat/composer-context-usage";
import type { ChatSessionRuntimeState } from "@/components/chat/chat-page-utils";
import {
	CHAT_COMPOSER_ATTACHMENT_BUTTON_CLASS_NAME,
	CHAT_COMPOSER_TEXTAREA_CLASS_NAME,
	CHAT_COMPOSER_TOOLBAR_CLASS_NAME,
	ChatComposerRoot,
	ChatComposerSurface,
} from "@/components/chat/chat-composer-frame";
import { ComposerRunConfig } from "@/components/chat/chat-composer-run-config";
import { useChatComposerImages } from "@/components/chat/use-chat-composer-images";
import { useChatComposerInput } from "@/components/chat/use-chat-composer-input";
import {
	ComposerSuggestionMenu,
	DEFAULT_SUGGESTIONS,
	type ComposerSuggestion,
} from "@/components/chat/chat-composer-suggestions";

export type {
	ComposerSuggestion,
	ComposerSuggestionKind,
} from "@/components/chat/chat-composer-suggestions";

type ChatComposerProps = {
	value: string;
	onChange: (value: string) => void;
	images?: readonly ChatImageAttachment[];
	onImagesChange?: (images: ChatImageAttachment[]) => void;
	onSubmit?: (submission: ChatSubmission) => void;
	onSteer?: (submission: ChatSubmission) => void;
	onFollowUp?: (submission: ChatSubmission) => void;
	onSendNow?: (submission: ChatSubmission) => Promise<void>;
	placeholder?: string;
	disabled?: boolean;
	muted?: boolean;
	running?: boolean;
	onStop?: () => void;
	pendingFollowUps?: number;
	statusText?: string;
	statusError?: string | null;
	compacting?: boolean;
	retrying?: boolean;
	onAbortRetry?: () => void;
	contextUsage?: ChatSessionRuntimeState | null;
	models?: readonly PiModel[];
	modelScope?: ModelScopeControls;
	canEditScope?: boolean;
	selectedModel?: PiModel | null;
	modelLoading?: boolean;
	modelError?: string | null;
	modelDisabled?: boolean;
	onModelMenuOpen?: () => void;
	onModelRefresh?: () => void;
	onModelChange?: (model: PiModel | null) => void;
	thinkingLevels?: readonly PiThinkingLevel[];
	selectedThinkingLevel?: PiThinkingLevel | null;
	thinkingLoading?: boolean;
	thinkingDisabled?: boolean;
	onThinkingMenuOpen?: () => void;
	onThinkingChange?: (level: PiThinkingLevel | null) => void;
	suggestions?: readonly ComposerSuggestion[];
	onSuggestionTrigger?: (trigger: "@" | "/" | null, query: string) => void;
	historyKey?: string | null;
	className?: string;
	/** 桌面专属的快捷键提示与自动聚焦；Remote WebUI 传 false。 */
	desktopShortcuts?: boolean;
};

const EMPTY_MODELS: readonly PiModel[] = [];
const EMPTY_THINKING_LEVELS: readonly PiThinkingLevel[] = [];

export function ChatComposer({
	value,
	onChange,
	images,
	onImagesChange,
	onSubmit,
	onSteer,
	onFollowUp,
	onSendNow,
	placeholder,
	disabled = false,
	muted = false,
	running = false,
	onStop,
	pendingFollowUps = 0,
	statusText = "",
	statusError = null,
	compacting = false,
	retrying = false,
	onAbortRetry,
	contextUsage = null,
	models = EMPTY_MODELS,
	modelScope,
	canEditScope = true,
	selectedModel = null,
	modelLoading = false,
	modelError = null,
	modelDisabled = false,
	onModelMenuOpen,
	onModelRefresh,
	onModelChange,
	thinkingLevels = EMPTY_THINKING_LEVELS,
	selectedThinkingLevel = null,
	thinkingLoading = false,
	thinkingDisabled = false,
	onThinkingMenuOpen,
	onThinkingChange,
	suggestions = DEFAULT_SUGGESTIONS,
	onSuggestionTrigger,
	historyKey,
	className,
	desktopShortcuts = true,
}: ChatComposerProps) {
	const { t } = useTranslation();
	const composerPlaceholder = placeholder ?? t("chat.composerPlaceholder");
	const {
		keyboardShortcuts,
		sendMessageShortcut,
		readingFontSize,
		readingFontFamily,
	} = usePreferences();
	const { fileInputRef, attachments, updateImages, handleFiles, handlePaste } =
		useChatComposerImages({ images, onImagesChange });
	const {
		sendMode,
		setSendMode,
		sendingNow,
		canSubmit,
		textareaRef,
		showFocusHint,
		suggestionMenuOpen,
		activeQuery,
		queryMeta,
		filteredSuggestions,
		effectiveHighlightedIndex,
		setHighlightedIndex,
		selectSuggestion,
		handleKeyDown,
		syncCaret,
		submit,
		onFieldChange,
	} = useChatComposerInput({
		value,
		onChange,
		attachments,
		selectedModel,
		disabled,
		compacting,
		running,
		onSubmit,
		onSteer,
		onFollowUp,
		onSendNow,
		suggestions,
		onSuggestionTrigger,
		historyKey,
		desktopShortcuts,
	});

	return (
		<ChatComposerRoot className={className}>
			{suggestionMenuOpen && activeQuery && queryMeta ? (
				<ComposerSuggestionMenu
					activeQuery={activeQuery}
					title={t(queryMeta.titleKey)}
					suggestions={filteredSuggestions}
					highlightedIndex={effectiveHighlightedIndex}
					onHighlight={setHighlightedIndex}
					onSelect={selectSuggestion}
				/>
			) : null}

			{statusText || statusError || (retrying && onAbortRetry) ? (
				<NoticeCard
					announce={statusError ? "alert" : "status"}
					ariaLive="polite"
					className="mb-2 px-3 py-2"
				>
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						{statusText ? (
							<span className="min-w-0 flex-1 break-words tabular-nums text-muted-foreground">
								{statusText}
							</span>
						) : null}
						{retrying && onAbortRetry ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="ml-auto h-7 shrink-0 px-2 text-xs text-muted-foreground pointer-coarse:h-11"
								onClick={onAbortRetry}
							>
								{t("chat.stopRetry")}
							</Button>
						) : null}
					</div>
					{statusError ? (
						<div className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-5 text-destructive [overflow-wrap:anywhere]">
							{statusError}
						</div>
					) : null}
				</NoticeCard>
			) : null}

			<ChatComposerSurface muted={muted}>
				{attachments.length > 0 ? (
					<div className="flex flex-wrap gap-1.5 px-1 pb-1">
						{attachments.map((attachment) => (
							<div key={attachment.id} className="relative">
								<ChatImageThumbnail
									image={{
										id: attachment.id,
										name: attachment.name,
										mimeType: attachment.mimeType,
										size: attachment.size,
										source: "local",
									}}
								/>
								<button
									type="button"
									disabled={disabled || sendingNow}
									aria-label={t("chat.removeAttachment", {
										name: attachment.name,
									})}
									className={cn(
										"absolute -right-1.5 -top-1.5 z-10 inline-flex size-5 items-center justify-center rounded-full",
										"border border-border/70 bg-background text-muted-foreground shadow-sm transition-colors",
										"hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
										(disabled || sendingNow) && "opacity-60",
									)}
									onClick={() =>
										updateImages(
											attachments.filter((item) => item.id !== attachment.id),
										)
									}
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				) : null}

				<Textarea
					data-chat-composer-input=""
					ref={textareaRef}
					// 移动端软键盘的回车键文案与实际行为一致（Enter 发送时显示“发送”）
					enterKeyHint={sendMessageShortcut === "enter" ? "send" : "enter"}
					value={value}
					onChange={(event) => {
						onFieldChange(
							event.target.value,
							event.target.selectionStart ?? event.target.value.length,
						);
					}}
					onSelect={syncCaret}
					onClick={syncCaret}
					onKeyUp={syncCaret}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					disabled={disabled || sendingNow}
					rows={2}
					style={
						{
							"--pilo-reading-font-size": `${readingFontSize}px`,
							fontFamily: `var(--pilo-mobile-font-family, ${getPageFontFamilyStack(readingFontFamily)})`,
						} as CSSProperties
					}
					placeholder={composerPlaceholder}
					className={cn(
						CHAT_COMPOSER_TEXTAREA_CLASS_NAME,
						showFocusHint && "pr-16",
					)}
				/>

				{showFocusHint ? (
					<div
						className="pointer-events-none absolute right-2 top-1.5 z-10 flex items-center gap-0.5 font-mono text-2xs text-muted-foreground opacity-70 transition-opacity group-focus-within:opacity-0"
						aria-hidden="true"
					>
						{formatKeyboardShortcut(keyboardShortcuts["focus-composer"]).map(
							(label, index) => (
								<span key={label} className="flex items-center gap-0.5">
									{index > 0 ? <span>+</span> : null}
									<kbd className="rounded border border-border/70 bg-muted/50 px-1 py-px">
										{label}
									</kbd>
								</span>
							),
						)}
					</div>
				) : null}

				<div
					data-chat-composer-toolbar=""
					className={CHAT_COMPOSER_TOOLBAR_CLASS_NAME}
				>
					<input
						ref={fileInputRef}
						type="file"
						disabled={disabled || sendingNow}
						accept={CHAT_IMAGE_ACCEPT}
						multiple
						className="hidden"
						onChange={handleFiles}
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								disabled={disabled || sendingNow}
								variant="ghost"
								size="icon"
								className={CHAT_COMPOSER_ATTACHMENT_BUTTON_CLASS_NAME}
								aria-label={t("chat.addAttachment")}
								onClick={() => fileInputRef.current?.click()}
							>
								<Plus className="size-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("chat.addAttachment")}</TooltipContent>
					</Tooltip>

					<ComposerRunConfig
						models={models}
						modelScope={modelScope}
						canEditScope={canEditScope}
						selectedModel={selectedModel}
						modelLoading={modelLoading}
						modelError={modelError}
						modelDisabled={modelDisabled}
						onModelMenuOpen={onModelMenuOpen}
						onModelRefresh={onModelRefresh}
						onModelChange={onModelChange}
						thinkingLevels={thinkingLevels}
						selectedThinkingLevel={selectedThinkingLevel}
						thinkingLoading={thinkingLoading}
						thinkingDisabled={thinkingDisabled}
						onThinkingMenuOpen={onThinkingMenuOpen}
						onThinkingChange={onThinkingChange}
					/>

					{pendingFollowUps > 0 ? (
						<span className="hidden text-2xs tabular-nums text-muted-foreground @min-[40rem]:inline">
							{t("chat.pendingFollowUp", { count: pendingFollowUps })}
						</span>
					) : null}
					<ComposerContextUsage
						usage={contextUsage}
						contextWindow={selectedModel?.contextWindow}
					/>

					<ComposerActions
						value={value}
						hasAttachments={attachments.length > 0}
						disabled={disabled || sendingNow}
						running={running}
						sendMessageShortcut={sendMessageShortcut}
						showShortcutHint={desktopShortcuts}
						onStop={onStop}
						canSteer={Boolean(onSteer)}
						canFollowUp={Boolean(onFollowUp)}
						canSendNow={Boolean(onSendNow)}
						canSubmit={canSubmit}
						sendMode={sendMode}
						onSendModeChange={setSendMode}
						submitBlocked={compacting || sendingNow}
						onPrimary={submit}
					/>
				</div>
			</ChatComposerSurface>
		</ChatComposerRoot>
	);
}
