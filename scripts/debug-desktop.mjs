#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const help = `Usage: pnpm debug:desktop [options] [command]

Connect to a running Pilo development build (start it with pnpm dev).

Commands:
  status                  Check the WebDriver server (default)
  windows                 List window labels
  source                  Print the current DOM as HTML
  screenshot              Save a PNG under logs/
  eval <script>           Execute a JavaScript function body; use return for results
  click <css>             Click the first matching element
  type <css> <text>       Append text to the first matching input/editable element

Options:
  --port <port>           WebDriver port (TAURI_WEBDRIVER_PORT or 4445)
  --window <label>        Target window (default: main)
  --help                  Show this help

Examples:
  pnpm debug:desktop screenshot
  pnpm debug:desktop eval 'return document.activeElement.outerHTML'
  pnpm debug:desktop click 'button[aria-label="Settings"]'
  pnpm debug:desktop type '[contenteditable="true"]' 'Hello'
  pnpm debug:desktop --window session-123 source

Commands operate on real application state. Session cleanup does not close Pilo.`;

function print(value) {
	console.log(
		typeof value === "string" ? value : JSON.stringify(value, null, 2),
	);
}

async function main() {
	const { values, positionals } = parseArgs({
		options: {
			port: { type: "string" },
			window: { type: "string", default: "main" },
			help: { type: "boolean" },
		},
		allowPositionals: true,
	});
	if (values.help) {
		console.log(help);
		return;
	}

	const [command = "status", ...args] = positionals;
	const arity = new Map([
		["status", 0],
		["windows", 0],
		["source", 0],
		["screenshot", 0],
		["eval", 1],
		["click", 1],
		["type", 2],
	]);
	if (!arity.has(command) || args.length !== arity.get(command)) {
		throw new Error(`Invalid command or arguments: ${command}. Use --help.`);
	}
	const port = values.port ?? process.env.TAURI_WEBDRIVER_PORT ?? "4445";
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		throw new Error(`Invalid WebDriver port: ${port}`);
	}
	const base = `http://127.0.0.1:${Number(port)}`;
	async function request(method, path, body) {
		let response;
		try {
			response = await fetch(`${base}${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(35_000),
			});
		} catch (error) {
			throw new Error(
				`WebDriver request failed at ${base}. Start Pilo with pnpm dev and check the port. ${error.message}`,
				{ cause: error },
			);
		}
		const { value } = await response.json();
		if (!response.ok) {
			throw new Error(
				`${method} ${path}: ${value?.error ?? response.status}: ${value?.message ?? response.statusText}`,
			);
		}
		return value;
	}
	if (command === "status") {
		print(await request("GET", "/status"));
		return;
	}

	const { sessionId } = await request("POST", "/session", {
		capabilities: {
			alwaysMatch: {
				"wdio:tauriServiceOptions": { windowLabel: values.window },
			},
		},
	});
	const session = `/session/${encodeURIComponent(sessionId)}`;
	try {
		switch (command) {
			case "windows":
				print(await request("GET", `${session}/window/handles`));
				break;
			case "source":
				print(await request("GET", `${session}/source`));
				break;
			case "screenshot": {
				const png = await request("GET", `${session}/screenshot`);
				const directory = new URL("../logs/", import.meta.url);
				await mkdir(directory, { recursive: true });
				const file = new URL(`desktop-${Date.now()}.png`, directory);
				await writeFile(file, Buffer.from(png, "base64"), { flag: "wx" });
				console.log(fileURLToPath(file));
				break;
			}
			case "eval":
				print(
					await request("POST", `${session}/execute/sync`, {
						script: args[0],
						args: [],
					}),
				);
				break;
			case "click":
			case "type": {
				const element = await request("POST", `${session}/element`, {
					using: "css selector",
					value: args[0],
				});
				const id = encodeURIComponent(
					element["element-6066-11e4-a52e-4f735466cecf"],
				);
				await request(
					"POST",
					`${session}/element/${id}/${command === "click" ? "click" : "value"}`,
					command === "click" ? {} : { text: args[1] },
				);
				break;
			}
		}
	} finally {
		await request("DELETE", session).catch((error) => {
			console.error(`WebDriver session cleanup failed: ${error.message}`);
			process.exitCode = 1;
		});
	}
}

try {
	await main();
} catch (error) {
	console.error(`[desktop-debug] ${error.message}`);
	process.exitCode = 1;
}
