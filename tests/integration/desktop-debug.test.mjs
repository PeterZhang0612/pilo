import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("../../scripts/debug-desktop.mjs", import.meta.url),
);

function run(args, port) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script, ...args], {
			env: { ...process.env, TAURI_WEBDRIVER_PORT: String(port) },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
		child.stderr.setEncoding("utf8").on("data", (text) => (stderr += text));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

async function driver(t, reply = () => null) {
	const requests = [];
	const server = createServer(async (req, res) => {
		let text = "";
		for await (const chunk of req) text += chunk;
		const entry = {
			method: req.method,
			path: req.url,
			body: text ? JSON.parse(text) : undefined,
		};
		requests.push(entry);
		const result =
			req.url === "/session" && req.method === "POST"
				? { value: { sessionId: "debug-session" } }
				: reply(entry);
		res.writeHead(result?.status ?? 200, {
			"Content-Type": "application/json",
		});
		res.end(JSON.stringify({ value: result?.value ?? null }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return { port: server.address().port, requests };
}

function assertCleanedUp(requests) {
	assert.deepEqual(requests.at(-1), {
		method: "DELETE",
		path: "/session/debug-session",
		body: undefined,
	});
	assert.equal(
		requests.some((r) => r.method === "DELETE" && r.path.endsWith("/window")),
		false,
	);
}

test("desktop debug validates CLI arguments without connecting", async () => {
	const help = await run(["--help"], 0);
	assert.equal(help.code, 0);
	assert.match(help.stdout, /Usage: pnpm debug:desktop/);
	await Promise.all(
		[
			["unknown"],
			["click"],
			["type", "input"],
			["--port", "0"],
			["--port", "65536"],
		].map(async (args) => {
			const result = await run(args, 0);
			assert.equal(result.code, 1);
			assert.match(result.stderr, /Invalid/);
		}),
	);
});

test("desktop debug defaults to status without creating a session", async (t) => {
	const { port, requests } = await driver(t, () => ({
		value: { ready: true },
	}));
	const result = await run([], port);
	assert.equal(result.code, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { ready: true });
	assert.deepEqual(requests, [
		{ method: "GET", path: "/status", body: undefined },
	]);
});

test("desktop debug executes JS in the selected window and releases the session", async (t) => {
	const { port, requests } = await driver(t, () => ({
		value: { error: "application data" },
	}));
	const result = await run(
		[
			"--port",
			String(port),
			"--window",
			"session-123",
			"eval",
			"return { error: 'application data' }",
		],
		0,
	);
	assert.equal(result.code, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { error: "application data" });
	assert.deepEqual(requests[0].body, {
		capabilities: {
			alwaysMatch: {
				"wdio:tauriServiceOptions": { windowLabel: "session-123" },
			},
		},
	});
	assert.deepEqual(requests[1], {
		method: "POST",
		path: "/session/debug-session/execute/sync",
		body: { script: "return { error: 'application data' }", args: [] },
	});
	assertCleanedUp(requests);
});

for (const command of ["click", "type"]) {
	test(`desktop debug ${command} uses native WebDriver element commands`, async (t) => {
		const { port, requests } = await driver(t, () => ({
			value: { "element-6066-11e4-a52e-4f735466cecf": "element/1" },
		}));
		const args =
			command === "click" ? [command, "button"] : [command, "input", "你好 👋"];
		const result = await run(args, port);
		assert.equal(result.code, 0, result.stderr);
		assert.deepEqual(requests[1].body, {
			using: "css selector",
			value: args[1],
		});
		assert.deepEqual(requests[2], {
			method: "POST",
			path: `/session/debug-session/element/element%2F1/${command === "click" ? "click" : "value"}`,
			body: command === "click" ? {} : { text: "你好 👋" },
		});
		assertCleanedUp(requests);
	});
}

for (const [command, endpoint, value] of [
	["source", "source", "<html><body>Pilo</body></html>"],
	["windows", "window/handles", ["main", "session-123"]],
]) {
	test(`desktop debug prints ${command}`, async (t) => {
		const { port, requests } = await driver(t, () => ({ value }));
		const result = await run([command], port);
		assert.equal(result.code, 0, result.stderr);
		assert.equal(requests[1].path, `/session/debug-session/${endpoint}`);
		assert.deepEqual(
			typeof value === "string"
				? result.stdout.trim()
				: JSON.parse(result.stdout),
			value,
		);
		assertCleanedUp(requests);
	});
}

test("desktop debug saves screenshot bytes inside the project", async (t) => {
	const png = Buffer.from("screenshot fixture");
	const { port, requests } = await driver(t, () => ({
		value: png.toString("base64"),
	}));
	const result = await run(["screenshot"], port);
	assert.equal(result.code, 0, result.stderr);
	const file = result.stdout.trim();
	t.after(() => unlink(file));
	assert.equal(
		file.startsWith(
			fileURLToPath(new URL("../../logs/desktop-", import.meta.url)),
		),
		true,
	);
	assert.deepEqual(await readFile(file), png);
	assertCleanedUp(requests);
});

test("desktop debug reports WebDriver errors and still releases the session", async (t) => {
	const { port, requests } = await driver(t, ({ method }) =>
		method === "DELETE"
			? null
			: {
					status: 404,
					value: { error: "no such element", message: "No matching input" },
				},
	);
	const result = await run(["click", "input"], port);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /no such element: No matching input/);
	assertCleanedUp(requests);
});

test("desktop debug reports session cleanup failures", async (t) => {
	const { port } = await driver(t, ({ method }) =>
		method === "DELETE"
			? {
					status: 500,
					value: { error: "unknown error", message: "Cleanup failed" },
				}
			: { value: "<html></html>" },
	);
	const result = await run(["source"], port);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /session cleanup failed/);
});

test("desktop debug gives a useful hint when the server is unavailable", async () => {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	const result = await run([], port);
	assert.equal(result.code, 1);
	assert.match(result.stderr, /Start Pilo with pnpm dev/);
});
