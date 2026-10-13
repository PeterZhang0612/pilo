#!/usr/bin/env node
import tauri from "@tauri-apps/cli";
import process from "node:process";

const args = process.argv.slice(2);
if (args[0] === "dev") {
	args.splice(1, 0, "--config", "src-tauri/tauri.dev.conf.json");
}

try {
	await tauri.run(args, "pnpm tauri");
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
