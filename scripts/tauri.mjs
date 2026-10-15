#!/usr/bin/env node
import tauri from "@tauri-apps/cli";
import process from "node:process";

const args = process.argv.slice(2);

try {
	if (args[0] === "dev" && !args.includes("--help") && !args.includes("-h")) {
		if (
			args.some(
				(arg) =>
					arg === "--release" ||
					arg === "--profile" ||
					arg.startsWith("--profile="),
			)
		) {
			throw new Error(
				"Development runtime isolation requires the default debug profile; use pnpm tauri build for release builds.",
			);
		}
		args.splice(1, 0, "--config", "src-tauri/tauri.dev.conf.json");
	}
	await tauri.run(args, "pnpm tauri");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
