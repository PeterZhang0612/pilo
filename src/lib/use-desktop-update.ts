import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { i18n } from "@/i18n";

type UpdateStatus =
	| "idle"
	| "checking"
	| "latest"
	| "available"
	| "downloading"
	| "installing"
	| "error";

function formatUpdateError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("public key") || message.includes("signature")) {
		return i18n.t("about.updateConfigUnavailable");
	}
	if (message.includes("network") || message.includes("fetch")) {
		return i18n.t("about.updateServiceUnavailable");
	}
	return message || i18n.t("about.updateFailed");
}

export function useDesktopUpdate() {
	const [status, setStatus] = useState<UpdateStatus>("idle");
	const [previewMode, setPreviewMode] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [availableVersion, setAvailableVersion] = useState<string | null>(null);
	const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [downloadedBytes, setDownloadedBytes] = useState(0);
	const [downloadTotalBytes, setDownloadTotalBytes] = useState<number | null>(
		null,
	);
	const updateRef = useRef<Update | null>(null);
	const checkingRef = useRef(false);
	const openOnAvailableRef = useRef(false);
	const installingRef = useRef(false);
	const requestIdRef = useRef(0);

	const checkForUpdates = useCallback(async ({ openDialog = true } = {}) => {
		if (installingRef.current) {
			if (openDialog) setDialogOpen(true);
			return;
		}
		if (checkingRef.current) {
			if (openDialog) openOnAvailableRef.current = true;
			return;
		}
		openOnAvailableRef.current = openDialog;
		checkingRef.current = true;
		const requestId = ++requestIdRef.current;
		setStatus("checking");
		setPreviewMode(false);
		setError(null);
		setAvailableVersion(null);
		setReleaseNotes(null);
		setDownloadedBytes(0);
		setDownloadTotalBytes(null);

		const previousUpdate = updateRef.current;
		updateRef.current = null;
		if (previousUpdate) await previousUpdate.close().catch(() => undefined);

		try {
			const update = await check({ timeout: 15_000 });
			if (requestId !== requestIdRef.current) {
				if (update) await update.close();
				return;
			}
			if (!update) {
				setStatus("latest");
				return;
			}
			updateRef.current = update;
			setAvailableVersion(update.version);
			setReleaseNotes(update.body ?? null);
			setStatus("available");
			if (openOnAvailableRef.current) setDialogOpen(true);
		} catch (cause) {
			if (requestId !== requestIdRef.current) return;
			setError(formatUpdateError(cause));
			setStatus("error");
		} finally {
			if (requestId === requestIdRef.current) checkingRef.current = false;
		}
	}, []);

	const previewUpdate = () => {
		if (!import.meta.env.DEV || installingRef.current) return;
		requestIdRef.current++;
		checkingRef.current = false;
		const previousUpdate = updateRef.current;
		updateRef.current = null;
		if (previousUpdate) void previousUpdate.close().catch(() => undefined);
		setPreviewMode(true);
		setAvailableVersion("99.0.0-preview");
		setReleaseNotes(null);
		setError(null);
		setStatus("available");
		setDialogOpen(true);
	};

	/* oxlint-disable react/set-state-in-effect -- 启动时同步外部更新服务，结果反映到 UI。 */
	/* oxlint-disable react-hooks/exhaustive-deps -- cleanup 释放当前句柄和请求，而不是 effect 启动时的旧值。 */
	useEffect(() => {
		if (!import.meta.env.DEV) void checkForUpdates({ openDialog: false });
		return () => {
			requestIdRef.current++;
			checkingRef.current = false;
			const update = updateRef.current;
			updateRef.current = null;
			if (update) void update.close();
		};
	}, [checkForUpdates]);
	/* oxlint-enable react-hooks/exhaustive-deps */
	/* oxlint-enable react/set-state-in-effect */

	const installUpdate = useCallback(async () => {
		if (import.meta.env.DEV && previewMode) {
			toast.info(i18n.t("settings.updatePreviewOnly"));
			return;
		}
		if (status === "error") {
			// Rechecking closes the old handle and any retained installer bytes.
			await checkForUpdates();
			return;
		}
		const update = updateRef.current;
		if (!update || checkingRef.current || installingRef.current) return;
		installingRef.current = true;
		setStatus("downloading");
		setError(null);
		setDownloadedBytes(0);
		setDownloadTotalBytes(null);

		try {
			await update.download((event) => {
				if (event.event === "Started") {
					setDownloadTotalBytes(event.data.contentLength ?? null);
					return;
				}
				if (event.event === "Progress") {
					setDownloadedBytes((current) => current + event.data.chunkLength);
					return;
				}
				setStatus("installing");
			});
			setStatus("installing");
			await update.install();
			await relaunch();
		} catch (cause) {
			setError(formatUpdateError(cause));
			setStatus("error");
		} finally {
			installingRef.current = false;
		}
	}, [checkForUpdates, previewMode, status]);

	const downloadProgress =
		downloadTotalBytes && downloadTotalBytes > 0
			? Math.min(100, Math.round((downloadedBytes / downloadTotalBytes) * 100))
			: null;

	return {
		status,
		availableVersion,
		releaseNotes,
		previewMode,
		dialogOpen,
		setDialogOpen,
		error,
		downloadProgress,
		downloadedBytes,
		downloadTotalBytes,
		checkForUpdates,
		installUpdate,
		previewUpdate,
	};
}

export type DesktopUpdate = ReturnType<typeof useDesktopUpdate>;
