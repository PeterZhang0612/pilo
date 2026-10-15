#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2] ?? "";
const env = {
	...process.env,
	CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "1",
	CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG || "0",
};
const windows = process.platform === "win32";
const args = windows
	? [
			...(process.env.PILO_DEV_WSL_DISTRO
				? ["--distribution", process.env.PILO_DEV_WSL_DISTRO]
				: []),
			"--exec",
			"bash",
			"-lc",
			'cd "$(wslpath -u "$1")" && export PATH="$HOME/.cargo/bin:$PATH" && CARGO_BUILD_JOBS="$3" CARGO_PROFILE_DEV_DEBUG="$4" exec bash scripts/build-pilo-server.sh --dev "$2"',
			"pilo-server-dev",
			root,
			target,
			env.CARGO_BUILD_JOBS,
			env.CARGO_PROFILE_DEV_DEBUG,
		]
	: ["scripts/build-pilo-server.sh", "--dev", target];

const result = spawnSync(windows ? "wsl.exe" : "bash", args, {
	cwd: root,
	stdio: "inherit",
	windowsHide: true,
	env,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
