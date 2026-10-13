import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { isImeComposingKeyboardEvent } from "@/lib/ime";
import { cn } from "@/lib/utils";
import { Input } from "@/ui";
import { SETTINGS_CONTROL_CLASS } from "./compact-layout";

export function FontSizeInput({
	value,
	min,
	max,
	label,
	onChange,
}: {
	value: number;
	min: number;
	max: number;
	label: string;
	onChange: (value: number) => void;
}) {
	const { t } = useTranslation();
	const hintId = useId();
	const [draft, setDraft] = useState<string | null>(null);
	const rangeHint = t("settings.fontSizeRange", { min, max });

	const commit = (text: string) => {
		const parsed = Number(text);
		const next =
			text.trim() && Number.isFinite(parsed)
				? Math.min(max, Math.max(min, parsed))
				: value;
		setDraft(null);
		if (next !== value) onChange(next);
	};

	return (
		<div className="relative min-w-0">
			<Input
				type="number"
				inputMode="decimal"
				min={min}
				max={max}
				step="any"
				value={draft ?? String(value)}
				aria-label={t("settings.fontSizeInputLabel", { font: label })}
				aria-describedby={hintId}
				title={rangeHint}
				className={cn(
					SETTINGS_CONTROL_CLASS,
					"w-full pr-7 tabular-nums pointer-coarse:h-11",
					"[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
				)}
				onFocus={() => setDraft(String(value))}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={(event) => commit(event.target.value)}
				onKeyDown={(event) => {
					if (isImeComposingKeyboardEvent(event)) return;
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						setDraft(String(value));
					}
				}}
			/>
			<span
				className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted-foreground"
				aria-hidden="true"
			>
				px
			</span>
			<span id={hintId} className="sr-only">
				{rangeHint}
			</span>
		</div>
	);
}
