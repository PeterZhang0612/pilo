import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink } from "lucide-react";

import appIconUrl from "../../src-tauri/icons/128x128.png";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import type { DesktopUpdate } from "@/lib/use-desktop-update";
import { useReleaseNotes } from "@/lib/use-release-notes";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Spinner,
} from "@/ui";

export function UpdateDialog({ update }: { update: DesktopUpdate }) {
	const { t, i18n } = useTranslation();
	const { notes, loading, failed, openRelease } = useReleaseNotes(
		update.availableVersion,
		update.releaseNotes,
		update.dialogOpen && !update.previewMode,
	);
	const downloading = update.status === "downloading";
	const installing = update.status === "installing";
	const busy = downloading || installing;
	const progress = update.downloadProgress;
	const numberFormat = new Intl.NumberFormat(i18n.language, {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	});
	const downloadedSize = `${numberFormat.format(update.downloadedBytes / 1_000_000)} MB`;
	const totalSize = update.downloadTotalBytes
		? `${numberFormat.format(update.downloadTotalBytes / 1_000_000)} MB`
		: null;

	return (
		<Dialog open={update.dialogOpen} onOpenChange={update.setDialogOpen}>
			<DialogContent
				overlayClassName="z-[var(--z-dialog)]"
				className="flex w-[min(480px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:p-0"
			>
				<header className="flex shrink-0 items-start gap-3 px-5 pb-4 pe-12 pt-5">
					<img
						src={appIconUrl}
						alt=""
						className="size-10 shrink-0 rounded-lg border border-border/60 bg-muted/40 object-cover"
					/>
					<div className="min-w-0 space-y-1">
						<DialogTitle className="text-sm font-semibold leading-5">
							{t("settings.updateDialogTitle")}
						</DialogTitle>
						<DialogDescription className="text-xs leading-relaxed">
							{t("settings.updateDialogDescription", {
								version: update.availableVersion ?? "",
							})}
						</DialogDescription>
					</div>
				</header>

				<section
					aria-label={t("settings.releaseNotes")}
					className="scrollbar-pro min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5"
				>
					<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
						<h2 className="text-xs font-medium text-muted-foreground">
							{t("settings.releaseNotes")}
						</h2>
						{!update.previewMode ? (
							<Button
								variant="ghost"
								size="sm"
								onClick={openRelease}
								className="-me-2 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground [@media(pointer:coarse)]:min-h-11"
							>
								GitHub Releases
								<ExternalLink className="size-3.5" />
							</Button>
						) : null}
					</div>
					<div className="min-h-24 rounded-lg border border-border/60 bg-muted/30 p-4">
						{update.previewMode ? (
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t("settings.updatePreviewOnly")}
							</p>
						) : (
							<>
								{loading ? (
									<output className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
										<Spinner className="size-3.5" />
										{t("settings.releaseNotesLoading")}
									</output>
								) : null}
								{failed ? (
									<output className="mb-3 block text-xs leading-relaxed text-muted-foreground">
										{t("settings.releaseNotesUnavailable")}
									</output>
								) : null}
								{notes ? (
									<Suspense
										fallback={
											<p className="whitespace-pre-wrap break-words text-sm">
												{notes}
											</p>
										}
									>
										<ChatMarkdown
											text={notes}
											className="break-words text-sm"
										/>
									</Suspense>
								) : !loading && !failed ? (
									<p className="text-xs leading-relaxed text-muted-foreground">
										{t("settings.releaseNotesEmpty")}
									</p>
								) : null}
							</>
						)}
					</div>
				</section>

				<footer className="shrink-0 space-y-3 border-t border-border/60 bg-muted/20 px-5 py-3">
					{busy ? (
						<div className="space-y-2">
							<output className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
								<span>
									{t(
										installing ? "settings.installing" : "settings.downloading",
									)}
								</span>
								{downloading && progress !== null ? (
									<span className="font-mono text-foreground">{progress}%</span>
								) : null}
							</output>
							<progress
								aria-label={t(
									installing ? "settings.installing" : "settings.downloading",
								)}
								max={100}
								value={downloading ? (progress ?? undefined) : undefined}
								className="block h-1 w-full overflow-hidden rounded-full border-0 bg-muted accent-primary [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
							/>
							{downloading ? (
								<p className="font-mono text-xs text-muted-foreground">
									{downloadedSize}
									{totalSize ? ` / ${totalSize}` : ""}
								</p>
							) : null}
							<p className="text-xs text-muted-foreground">
								{t("settings.updateBackgroundHint")}
							</p>
						</div>
					) : null}
					{update.error ? (
						<p
							role="alert"
							className="break-words text-xs leading-relaxed text-status-danger"
						>
							{update.error}
						</p>
					) : null}
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							variant="ghost"
							size="sm"
							className="text-muted-foreground [@media(pointer:coarse)]:min-h-11"
							onClick={() => update.setDialogOpen(false)}
						>
							{t("common.close")}
						</Button>
						<Button
							size="sm"
							disabled={busy}
							className="[@media(pointer:coarse)]:min-h-11"
							onClick={() => void update.installUpdate()}
						>
							{busy ? (
								<Spinner className="size-3.5" />
							) : (
								<Download className="size-3.5" />
							)}
							{busy
								? t(installing ? "settings.installing" : "settings.downloading")
								: update.status === "error"
									? t("common.retry")
									: t("settings.downloadInstall")}
						</Button>
					</div>
				</footer>
			</DialogContent>
		</Dialog>
	);
}
