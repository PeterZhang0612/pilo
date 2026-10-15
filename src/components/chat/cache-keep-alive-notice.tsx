import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CacheKeepAliveStatus } from "@/lib/cache-keep-alive";
import { NoticeCard, NoticeIcon } from "@/ui";

export function CacheKeepAliveStatusContent({
	status,
}: {
	status: CacheKeepAliveStatus;
}) {
	const { t } = useTranslation();
	let text;
	switch (status.reason) {
		case "warmed":
		case "scheduled":
			text = t(
				status.reason === "warmed"
					? "settings.cacheKeepAliveWarmed"
					: "settings.cacheKeepAliveScheduled",
				{
					time: status.nextWarmAtMs
						? new Date(status.nextWarmAtMs).toLocaleTimeString()
						: "—",
				},
			);
			break;
		case "window_ending":
			text = t("settings.cacheKeepAliveWindowEnding");
			break;
		case "warming":
			text = t("settings.cacheKeepAliveWarming");
			break;
		case "cache_expired":
			text = t("settings.cacheKeepAliveExpired");
			break;
		case "window_ended":
			text = t("settings.cacheKeepAliveWindowEnded");
			break;
		case "cache_miss":
			text = t("settings.cacheKeepAliveMiss");
			break;
		case "unsupported_request":
			text = t("settings.cacheKeepAliveUnsupported");
			break;
		case "timeout":
		case "request_failed":
			text = t("settings.cacheKeepAliveFailed");
			break;
		case "running":
			text = t("settings.cacheKeepAliveRunning");
			break;
		case "disabled":
			text = t("settings.cacheKeepAliveDisabled");
			break;
		default:
			text = t("settings.cacheKeepAliveWaiting");
	}
	if (!status.ready) text = t("settings.cacheKeepAliveUnsupported");
	return (
		<div className="min-w-0 space-y-1 text-xs leading-5 text-muted-foreground">
			<p>{text}</p>
			{status.requestCount > 0 ? (
				<p>
					{t("settings.cacheKeepAliveUsage", {
						count: status.requestCount,
						tokens: status.cacheReadTokens,
						cost: status.cost === null ? "—" : `$${status.cost.toFixed(6)}`,
					})}
				</p>
			) : null}
		</div>
	);
}

export function CacheKeepAliveNotice({
	status,
}: {
	status: CacheKeepAliveStatus | null;
}) {
	if (
		!status ||
		["disabled", "waiting_request", "running", "context_changed"].includes(
			status.reason,
		)
	)
		return null;
	return (
		<NoticeCard
			announce="status"
			ariaLive="polite"
			className="flex items-start gap-2.5 px-3 py-2"
		>
			<NoticeIcon
				icon={Timer}
				tone={status.status === "unavailable" ? "warning" : "info"}
			/>
			<CacheKeepAliveStatusContent status={status} />
		</NoticeCard>
	);
}
