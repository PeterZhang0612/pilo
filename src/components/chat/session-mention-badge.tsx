import { MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SessionMention } from "@/lib/session-mentions";
import { cn } from "@/lib/utils";
import { Hint, Popover, PopoverContent, PopoverTrigger } from "@/ui";

/** The same compact surface as a sent Skill, with a touch-accessible path preview. */
export function SessionMentionBadge({
	mention,
	compact = false,
}: {
	mention: SessionMention;
	compact?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<Popover>
			<Hint label={mention.path}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={t("chat.sessionMentionPath", { title: mention.title })}
						className={cn(
							"inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-foreground/10 bg-background/40 px-2 py-1 text-xs align-middle focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
							compact && "h-7 max-w-[min(16rem,100%)] shrink-0 px-1.5 py-0",
						)}
					>
						<MessageSquare
							className="size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="min-w-0 truncate">{mention.title}</span>
					</button>
				</PopoverTrigger>
			</Hint>
			<PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-3 text-xs">
				<p className="mb-1 break-words font-medium">{mention.title}</p>
				<p className="mb-1 break-words text-muted-foreground">
					{mention.projectName}
				</p>
				<p className="select-text break-all font-mono">{mention.path}</p>
			</PopoverContent>
		</Popover>
	);
}
