import { useEffect, useId, useRef, useState } from "react";
import { Check, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getProjectScopeDraft, piModelsMatch } from "@/lib/pi-model-selection";
import { runtimeErrorMessage, type PiModel } from "@/lib/pi-runtime";
import type {
	ModelScopeControls,
	ProjectScopedModel,
} from "@/lib/project-model-scope";
import { cn } from "@/lib/utils";
import {
	Button,
	Checkbox,
	Command,
	CommandInput,
	CommandItem,
	CommandList,
	Input,
	Spinner,
} from "@/ui";

function identity(provider: string, id: string) {
	return JSON.stringify([provider, id]);
}

export function ChatModelPicker({
	models,
	selectedModel,
	loading,
	error,
	disabled,
	onRefresh,
	onChange,
	modelScope,
	canEditScope,
	compact = false,
}: {
	models: readonly PiModel[];
	selectedModel: PiModel | null;
	loading: boolean;
	error: string | null;
	disabled: boolean;
	onRefresh?: () => void;
	onChange?: (model: PiModel | null) => void;
	modelScope?: ModelScopeControls;
	canEditScope: boolean;
	compact?: boolean;
}) {
	const { t } = useTranslation();
	const pickerId = useId();
	const [query, setQuery] = useState("");
	const [view, setView] = useState<"all" | "scope">("scope");
	const [draft, setDraft] = useState<{
		initial: ProjectScopedModel[];
		models: ProjectScopedModel[];
	} | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const editing = canEditScope && draft !== null;
	const searchRef = useRef<HTMLInputElement>(null);
	const wasEditingRef = useRef(false);
	useEffect(() => {
		if (editing || wasEditingRef.current) searchRef.current?.focus();
		wasEditingRef.current = editing;
	}, [editing]);
	const scopeReady = Boolean(
		modelScope?.scope && modelScope.catalogReady && !modelScope.error,
	);
	const saving = modelScope?.saving ?? false;
	const listLoading = loading || Boolean(modelScope?.loading);
	const listError = saveError ?? modelScope?.error ?? error;
	const listMaxHeight = compact
		? "max-h-[min(14rem,calc(var(--remote-viewport-height,100dvh)*0.35))]"
		: "max-h-[min(16rem,calc(var(--remote-viewport-height,100dvh)*0.35))]";
	const showModels = editing || view === "all" || scopeReady;
	const search = query.trim().toLowerCase();
	const matches = (provider: string, id: string, name = "") =>
		[name, id, provider].some((value) => value.toLowerCase().includes(search));
	const availableModels = modelScope?.availableModels ?? models;
	const visibleModels = (
		editing
			? availableModels
			: view === "all"
				? models
				: (modelScope?.models ?? [])
	).filter((model) => matches(model.provider, model.id, model.name));
	const unavailable =
		editing && draft
			? [...draft.initial, ...draft.models].filter(
					(entry, index, entries) =>
						!availableModels.some(
							(model) =>
								model.provider === entry.provider && model.id === entry.modelId,
						) &&
						entries.findIndex(
							(candidate) =>
								candidate.provider === entry.provider &&
								candidate.modelId === entry.modelId,
						) === index &&
						matches(entry.provider, entry.modelId),
				)
			: [];
	const dirty =
		draft !== null &&
		JSON.stringify(draft.initial) !== JSON.stringify(draft.models);

	const toggle = (provider: string, modelId: string) => {
		setDraft((current) => {
			if (!current) return current;
			const exists = current.models.some(
				(entry) => entry.provider === provider && entry.modelId === modelId,
			);
			const entry = current.initial.find(
				(candidate) =>
					candidate.provider === provider && candidate.modelId === modelId,
			) ?? { provider, modelId, thinkingLevel: null };
			return {
				...current,
				models: exists
					? current.models.filter(
							(candidate) =>
								candidate.provider !== provider ||
								candidate.modelId !== modelId,
						)
					: [...current.models, { ...entry }],
			};
		});
	};
	const save = async (nextModels: ProjectScopedModel[] | null) => {
		if (!modelScope || saving) return;
		setSaveError(null);
		try {
			await modelScope.save(nextModels);
			setDraft(null);
		} catch (cause) {
			setSaveError(runtimeErrorMessage(cause));
		}
	};
	const renderCheckbox = (
		provider: string,
		modelId: string,
		name: string,
		available: boolean,
	) => {
		const checkboxId = `${pickerId}-${encodeURIComponent(identity(provider, modelId))}`;
		return (
			<label
				key={identity(provider, modelId)}
				htmlFor={checkboxId}
				title={`${name || modelId} · ${provider} · ${modelId}${available ? "" : ` · ${t("chat.scopeUnavailable")}`}`}
				className={cn(
					"flex cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-50",
					compact ? "min-h-8 py-1.5" : "min-h-11 py-2",
				)}
			>
				<Checkbox
					id={checkboxId}
					aria-label={`${name || modelId} · ${provider} · ${modelId}${available ? "" : ` · ${t("chat.scopeUnavailable")}`}`}
					checked={
						draft?.models.some(
							(entry) =>
								entry.provider === provider && entry.modelId === modelId,
						) ?? false
					}
					disabled={saving}
					onCheckedChange={() => toggle(provider, modelId)}
				/>
				{compact ? (
					<>
						<span className="min-w-0 flex-1 truncate">{name || modelId}</span>
						<span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
							{provider}
							{!available ? ` · ${t("chat.scopeUnavailable")}` : ""}
						</span>
					</>
				) : (
					<span className="min-w-0 flex-1">
						<span className="block break-words">{name || modelId}</span>
						<span className="block break-all text-xs text-muted-foreground">
							{provider} · {modelId}
							{!available ? ` · ${t("chat.scopeUnavailable")}` : ""}
						</span>
					</span>
				)}
			</label>
		);
	};

	const content = (
		<>
			<div
				role="presentation"
				className="flex items-center gap-2 p-2"
				onKeyDown={(event) => {
					// Toolbar keys must not select cmdk's active model.
					if (event.key !== "Tab" && event.key !== "Escape")
						event.stopPropagation();
				}}
			>
				{editing ? (
					<div className="min-w-0 flex-1">
						<div className="text-sm font-medium">
							{t("chat.editProjectScope")}
						</div>
						<output
							aria-live="polite"
							className="text-xs tabular-nums text-muted-foreground"
						>
							{t("chat.scopeSelectedCount", { count: draft.models.length })}
						</output>
					</div>
				) : (
					<div className="flex flex-1 gap-0.5 rounded-md bg-muted p-0.5">
						{(["scope", "all"] as const).map((option) => (
							<Button
								key={option}
								type="button"
								size="sm"
								variant="ghost"
								className={cn(
									"flex-1 rounded-sm px-3 text-sm font-normal text-muted-foreground",
									compact ? "h-7" : "min-h-11",
									view === option &&
										"bg-background text-foreground shadow-xs hover:bg-background",
								)}
								aria-pressed={view === option}
								onClick={() => setView(option)}
							>
								{option === "scope"
									? t("chat.scopedModels")
									: t("chat.allModels")}
							</Button>
						))}
					</div>
				)}
				<div className="ms-auto shrink-0">
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className={cn(
							"rounded-lg text-muted-foreground",
							compact ? "size-8" : "size-11",
						)}
						disabled={listLoading || saving || !onRefresh}
						aria-label={t("chat.refreshModels")}
						title={t("chat.refreshModels")}
						onClick={() => {
							searchRef.current?.focus();
							onRefresh?.();
							void modelScope?.refresh();
						}}
					>
						<RefreshCw
							className={cn(
								"size-3.5",
								listLoading && "motion-safe:animate-spin",
							)}
							aria-hidden="true"
						/>
					</Button>
				</div>
			</div>
			<div className="px-2 pb-2">
				{editing ? (
					<div className="relative">
						<Search
							className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							ref={searchRef}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							aria-label={t("chat.searchModels")}
							placeholder={t("chat.searchModels")}
							className={cn(
								"rounded-md ps-10 pe-3",
								compact ? "h-8 text-sm" : "min-h-11 text-base md:text-sm",
							)}
						/>
					</div>
				) : (
					<CommandInput
						ref={searchRef}
						value={query}
						onValueChange={setQuery}
						aria-label={t("chat.searchModels")}
						placeholder={t("chat.searchModels")}
						className={cn(
							"text-input-foreground placeholder:text-input-placeholder",
							compact ? "text-sm" : "text-base md:text-sm",
						)}
						wrapperClassName={cn(
							"rounded-md border border-input-border bg-input-field px-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
							compact ? "h-8" : "h-11",
						)}
					/>
				)}
			</div>
			{editing ? (
				<div className="flex flex-wrap items-center justify-between gap-1 px-2 pb-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={compact ? undefined : "min-h-11"}
						disabled={saving}
						onClick={() =>
							setDraft((current) => {
								if (!current) return current;
								const additions = visibleModels
									.filter(
										(model) =>
											!current.models.some(
												(entry) =>
													entry.provider === model.provider &&
													entry.modelId === model.id,
											),
									)
									.map(
										(model) =>
											current.initial.find(
												(entry) =>
													entry.provider === model.provider &&
													entry.modelId === model.id,
											) ?? {
												provider: model.provider,
												modelId: model.id,
												thinkingLevel: null,
											},
									);
								return {
									...current,
									models: [...current.models, ...additions],
								};
							})
						}
					>
						{t("chat.selectSearchResults")}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={compact ? undefined : "min-h-11"}
						disabled={saving}
						onClick={() =>
							setDraft((current) =>
								current ? { ...current, models: [] } : current,
							)
						}
					>
						{t("chat.clearScopeSelection")}
					</Button>
				</div>
			) : null}
			{listError ? (
				<p
					role="alert"
					className="mx-3 mb-2 max-h-20 overflow-y-auto rounded-lg bg-destructive/5 p-2 text-xs break-words text-destructive"
				>
					{listError}
				</p>
			) : null}
			{listLoading &&
			(!showModels ||
				(visibleModels.length === 0 && unavailable.length === 0)) ? (
				<output
					aria-live="polite"
					className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-muted-foreground"
				>
					<Spinner className="size-3.5" />
					{t("chat.readingModels")}
				</output>
			) : null}
			{editing ? (
				<fieldset
					aria-label={t("chat.editProjectScope")}
					className={cn(
						"min-w-0",
						listMaxHeight,
						"overflow-y-auto overscroll-contain px-1 pb-1",
					)}
				>
					{visibleModels.map((model) =>
						renderCheckbox(model.provider, model.id, model.name, true),
					)}
					{unavailable.map((entry) =>
						renderCheckbox(entry.provider, entry.modelId, entry.modelId, false),
					)}
					{visibleModels.length === 0 &&
					unavailable.length === 0 &&
					!listLoading &&
					!listError ? (
						<p className="px-3 py-6 text-center text-xs text-muted-foreground">
							{search ? t("chat.noModelMatches") : t("chat.noModels")}
						</p>
					) : null}
				</fieldset>
			) : (
				<CommandList
					aria-label={t("chat.model")}
					containerClassName={listMaxHeight}
					viewportClassName={listMaxHeight}
				>
					<div className="px-1 pb-1">
						{showModels
							? visibleModels.map((model) => (
									<CommandItem
										key={identity(model.provider, model.id)}
										value={identity(model.provider, model.id)}
										disabled={disabled || !onChange}
										onSelect={() => onChange?.(model)}
										title={`${model.name || model.id} · ${model.provider} · ${model.id}`}
										aria-label={`${model.name || model.id} · ${model.provider} · ${model.id}${piModelsMatch(model, selectedModel) ? ` · ${t("chat.currentModel")}` : ""}`}
										className={cn(
											"gap-2 rounded-md px-2",
											compact ? "min-h-8 py-1.5" : "min-h-11",
										)}
									>
										{compact ? (
											<>
												<span className="min-w-0 flex-1 truncate">
													{model.name || model.id}
												</span>
												<span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
													{model.provider}
												</span>
											</>
										) : (
											<span className="min-w-0 flex-1">
												<span className="block break-words">
													{model.name || model.id}
												</span>
												<span className="block break-all text-xs text-muted-foreground">
													{model.provider} · {model.id}
												</span>
											</span>
										)}
										<span
											className="flex size-4 shrink-0 items-center justify-center"
											aria-hidden="true"
										>
											{piModelsMatch(model, selectedModel) ? (
												<Check className="size-3.5" />
											) : null}
										</span>
									</CommandItem>
								))
							: null}
						{!listLoading &&
						!listError &&
						(!showModels || visibleModels.length === 0) ? (
							<p className="px-3 py-6 text-center text-xs text-muted-foreground">
								{!showModels
									? t("chat.scopeNotResolved")
									: search
										? t("chat.noModelMatches")
										: view === "scope"
											? t("chat.emptyScope")
											: t("chat.noModels")}
							</p>
						) : null}
					</div>
				</CommandList>
			)}
			{!editing && view === "scope" && modelScope ? (
				<div
					role="presentation"
					className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-2 py-1.5"
					onKeyDown={(event) => {
						if (event.key !== "Tab" && event.key !== "Escape")
							event.stopPropagation();
					}}
				>
					<span className="text-xs text-muted-foreground">
						{t("chat.scopedModels")}
						{modelScope.scope ? (
							<>
								{" "}
								·{" "}
								{modelScope.scope.models === null
									? t("chat.scopeInherited")
									: t("chat.scopeCustom")}
							</>
						) : null}
					</span>
					{canEditScope ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn("ms-auto", !compact && "min-h-11")}
							disabled={!scopeReady || saving || listLoading}
							onClick={() => {
								if (!modelScope.scope) return;
								const initial = getProjectScopeDraft(
									modelScope.models,
									modelScope.scope,
								);
								setDraft({ initial, models: [...initial] });
								setSaveError(null);
							}}
						>
							<SlidersHorizontal className="size-3.5" aria-hidden="true" />
							{t("chat.editScope")}
						</Button>
					) : null}
				</div>
			) : null}
			{editing && draft ? (
				<div className="space-y-1.5 border-t border-border p-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">
							{modelScope?.scope?.models === null
								? t("chat.scopeInherited")
								: t("chat.scopeCustom")}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn("ms-auto", !compact && "min-h-11")}
							disabled={saving || modelScope?.scope?.models === null}
							onClick={() => void save(null)}
						>
							{t("chat.restorePiScope")}
						</Button>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							className={compact ? undefined : "min-h-11"}
							disabled={saving}
							onClick={() => {
								setDraft(null);
								setSaveError(null);
							}}
						>
							{t("common.cancel")}
						</Button>
						<Button
							type="button"
							size="sm"
							className={compact ? undefined : "min-h-11"}
							disabled={saving || !dirty}
							onClick={() => void save(draft.models)}
						>
							{saving ? <Spinner className="size-3.5" /> : null}
							{t("chat.applyProjectScope")}
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
	return editing ? (
		<div className="font-sans text-sm font-normal">{content}</div>
	) : (
		<Command
			shouldFilter={false}
			className="h-auto rounded-xl bg-background font-sans text-sm font-normal text-foreground"
		>
			{content}
		</Command>
	);
}
