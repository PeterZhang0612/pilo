export type ComposerSendMode = "steer" | "follow_up" | "send_now";

const STORAGE_KEY = "pilo.composerSendMode.v1";
const DEFAULT_SEND_MODE: ComposerSendMode = "steer";

export function isComposerSendMode(value: unknown): value is ComposerSendMode {
	return value === "steer" || value === "follow_up" || value === "send_now";
}

/**
 * The send mode is a sticky frontend choice: it survives reloads and project or
 * session switches, and only changes when the user picks another mode. It is a
 * delivery detail of the next message, so the backend never stores it.
 */
export function readComposerSendMode(): ComposerSendMode {
	if (typeof window === "undefined") return DEFAULT_SEND_MODE;
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		return isComposerSendMode(stored) ? stored : DEFAULT_SEND_MODE;
	} catch {
		return DEFAULT_SEND_MODE;
	}
}

export function writeComposerSendMode(mode: ComposerSendMode): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// A sticky send mode is a convenience; storage failures must never block sending.
	}
}
