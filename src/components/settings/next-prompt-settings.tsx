import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { useNextPromptSettings } from "@/lib/use-next-prompt-settings";
import type { PiModel } from "@/lib/pi-runtime";
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
} from "@/ui";

type Config = ReturnType<typeof useNextPromptSettings>;

export function NextPromptSettingsFields({
	config,
	models,
	unavailable = false,
}: {
	config: Config;
	models: readonly PiModel[];
	unavailable?: boolean;
}) {
	const { t } = useTranslation();
	const id = useId();
	const settings = config.settings;
	const unique = new Map(
		models.map((model) => [JSON.stringify([model.provider, model.id]), model]),
	);
	if (settings?.model) {
		const selected = settings.model;
		const key = JSON.stringify([selected.provider, selected.id]);
		if (!unique.has(key))
			unique.set(key, { ...selected, name: selected.id, reasoning: false });
	}
	return (
		<div className="min-w-0 space-y-3">
			<div className="flex items-center justify-between gap-4">
				<label htmlFor={id} className="text-sm font-medium">
					{t("settings.nextPrompt")}
				</label>
				<Switch
					id={id}
					checked={settings?.enabled ?? false}
					disabled={!settings || config.saving}
					onCheckedChange={(enabled) =>
						void config.save(enabled, settings?.model ?? null)
					}
				/>
			</div>
			<p className="text-xs leading-5 text-muted-foreground">
				{t("settings.nextPromptDescription")}
			</p>
			<label htmlFor={`${id}-model`} className="block text-xs font-medium">
				{t("settings.nextPromptModel")}
			</label>
			<Select
				value={
					settings?.model
						? JSON.stringify([settings.model.provider, settings.model.id])
						: "follow"
				}
				disabled={!settings || config.saving}
				onValueChange={(value) => {
					const model = unique.get(value);
					void config.save(
						settings?.enabled ?? false,
						model ? { provider: model.provider, id: model.id } : null,
					);
				}}
			>
				<SelectTrigger
					id={`${id}-model`}
					className="w-full min-w-0 pointer-coarse:min-h-11"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="max-w-[calc(100vw-2rem)]">
					<SelectItem value="follow">
						{t("settings.nextPromptFollowModel")}
					</SelectItem>
					{[...unique.entries()].map(([key, model]) => (
						<SelectItem key={key} value={key}>
							{model.name || model.id} · {model.provider}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{config.error ? (
				<p role="alert" className="break-words text-xs text-destructive">
					{config.error}
				</p>
			) : null}
			{unavailable ? (
				<output className="block text-xs text-muted-foreground">
					{t("settings.nextPromptUnavailable")}
				</output>
			) : null}
		</div>
	);
}

export function NextPromptSettingsButton(
	props: Parameters<typeof NextPromptSettingsFields>[0],
) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					type="button"
					className="size-7 shrink-0 text-muted-foreground pointer-coarse:size-11"
					aria-label={t("settings.nextPrompt")}
				>
					<Sparkles className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(var(--remote-viewport-height,100dvh)-2rem)] overflow-y-auto"
			>
				<NextPromptSettingsFields {...props} />
			</PopoverContent>
		</Popover>
	);
}
