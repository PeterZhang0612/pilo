#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
let closing = false;
function shutdown(code) {
	if (closing) return;
	closing = true;
	for (const child of children) {
		if (!child.pid) continue;
		if (process.platform === "win32") {
			if (child.exitCode !== null || child.signalCode !== null) continue;
			// Stop descendants as well as the Node launcher.
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

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => shutdown(0));
}

try {
	const frontend = process.argv.includes("--frontend");
	// WebUI serves dist/ from disk; desktop uses the Vite dev server.
	const commands = frontend
		? [
				["node_modules/vite/bin/vite.js"],
				["node_modules/vite/bin/vite.js", "build", "--watch"],
			]
		: [["scripts/tauri.mjs", "dev", "--features", "webdriver"]];
	for (const args of commands) {
		const child = spawn(process.execPath, args, {
			cwd: root,
			stdio: "inherit",
			detached: process.platform !== "win32",
		});
		children.push(child);
		child.on("exit", (code) => shutdown(code ?? 1));
		child.on("error", (error) => {
			console.error(error);
			shutdown(1);
		});
	}
} catch (error) {
	console.error("[pilo-dev] Startup failed:", error);
	shutdown(1);
}
