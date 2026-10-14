#!/usr/bin/env node
// Tauri dev only HMRs the desktop webview (from the Vite dev server).
// The Remote WebUI is served from `dist/` on disk, so we also run a Vite build
// in watch mode to keep `dist/` fresh for the embedded HTTP server.
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const commands = [
	["exec", "vite", "build", "--watch"],
	["tauri", "dev", "--features", "webdriver"],
];

const children = commands.map((args) =>
	spawn("pnpm", args, {
		stdio: "inherit",
		shell: process.platform === "win32",
		detached: process.platform !== "win32",
	}),
);

let closing = false;
function shutdown(code) {
	if (closing) return;
	closing = true;
	for (const child of children) {
		if (!child.pid) continue;
		if (process.platform === "win32") {
			if (child.exitCode !== null || child.signalCode !== null) continue;
			// Killing only cmd.exe leaves its pnpm/Vite descendants running.
			const result = spawnSync(
				"taskkill.exe",
				["/PID", String(child.pid), "/T", "/F"],
				{
					stdio: "ignore",
					timeout: 5000,
				},
			);
			if (result.error || result.status !== 0) {
				console.error(
					`Failed to stop dev process tree ${child.pid}`,
					result.error ?? result.status,
				);
			}
		} else {
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch (error) {
				if (error.code !== "ESRCH") console.error(error);
			}
		}
	}
	process.exit(code);
}

for (const child of children) {
	child.on("exit", (code) => shutdown(code ?? 0));
	child.on("error", () => shutdown(1));
}
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => shutdown(0));
}
