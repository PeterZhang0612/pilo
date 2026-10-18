import assert from "node:assert/strict";
import test from "node:test";

import {
	reduceProjectWorkspaces,
	workspaceFileKey,
	type ProjectWorkspace,
} from "../../src/lib/project-workspace.ts";
import {
	fileLinkPreviewKind,
	resolveMarkdownFileUrl,
} from "../../src/lib/chat/chat-markdown-links.ts";

const empty = () => new Map<string, ProjectWorkspace>();
const file = (path: string) => ({ path, content: `contents of ${path}` });

test("files deduplicate by path, reuse content and stay isolated by project", () => {
	const first = file("\\\\?\\C:\\repo\\main.ts");
	let state = reduceProjectWorkspaces(empty(), {
		type: "open",
		projectId: "a",
		file: first,
	});
	state = reduceProjectWorkspaces(state, {
		type: "select",
		projectId: "a",
		path: null,
	});
	state = reduceProjectWorkspaces(state, {
		type: "open",
		projectId: "a",
		file: file("c:/repo/main.ts"),
	});
	assert.deepEqual(state.get("a"), { files: [first], activePath: first.path });
	assert.equal(
		workspaceFileKey(first.path),
		workspaceFileKey("C:\\repo\\main.ts"),
	);
	state = reduceProjectWorkspaces(state, {
		type: "open",
		projectId: "b",
		file: file("/other/main.ts"),
	});
	assert.equal(state.get("a")?.activePath, first.path);
	assert.equal(state.get("b")?.files.length, 1);
	assert.notEqual(
		workspaceFileKey("/Repo/Main.ts"),
		workspaceFileKey("/Repo/main.ts"),
	);
});

test("closing files selects a neighbor or chat and never changes another project's tabs", () => {
	let state = empty();
	for (const name of ["one", "two", "three"])
		state = new Map(
			reduceProjectWorkspaces(state, {
				type: "open",
				projectId: "a",
				file: file(name),
			}),
		);
	let next = reduceProjectWorkspaces(state, {
		type: "close",
		projectId: "a",
		path: "one",
	});
	assert.equal(next.get("a")?.activePath, "three");
	next = reduceProjectWorkspaces(next, {
		type: "close",
		projectId: "a",
		path: "three",
	});
	assert.equal(next.get("a")?.activePath, "two");
	next = reduceProjectWorkspaces(next, {
		type: "close",
		projectId: "a",
		path: "two",
	});
	assert.equal(next.get("a")?.activePath, null);
	assert.equal(next.get("a")?.files.length, 0);
	assert.equal(
		reduceProjectWorkspaces(next, {
			type: "select",
			projectId: "a",
			path: "missing",
		}),
		next,
	);
});

test("chat selection retains files, stale highlights cannot overwrite a reopened file, deletion releases caches", () => {
	const original = file("/repo/a.ts");
	let state = reduceProjectWorkspaces(empty(), {
		type: "open",
		projectId: "a",
		file: original,
	});
	state = reduceProjectWorkspaces(state, {
		type: "select",
		projectId: "a",
		path: null,
	});
	assert.equal(state.get("a")?.files[0], original);
	state = reduceProjectWorkspaces(state, {
		type: "highlight",
		projectId: "a",
		file: original,
		html: "<pre>code</pre>",
	});
	assert.equal(state.get("a")?.files[0]?.html, "<pre>code</pre>");
	state = reduceProjectWorkspaces(state, {
		type: "close",
		projectId: "a",
		path: original.path,
	});
	state = reduceProjectWorkspaces(state, {
		type: "open",
		projectId: "a",
		file: file(original.path),
	});
	assert.equal(
		reduceProjectWorkspaces(state, {
			type: "highlight",
			projectId: "a",
			file: original,
			html: "stale",
		}),
		state,
	);
	assert.equal(
		reduceProjectWorkspaces(state, { type: "prune", projectIds: [] }).size,
		0,
	);
});

test("Markdown and common source files preview, HTML/documents use the default application", () => {
	for (const path of ["README.md", "notes.MARKDOWN"])
		assert.equal(fileLinkPreviewKind(path), "markdown");
	for (const path of [
		"main.ts",
		"App.tsx",
		"main.py",
		"lib.rs",
		"main.cpp",
		"App.java",
		"config.toml",
		"Dockerfile",
		"Makefile",
		".env",
		"C:\\repo\\app.vue",
		"notes.txt",
		"component.mdx",
		"script.sh",
	])
		assert.equal(fileLinkPreviewKind(path), "code", path);
	for (const path of [
		"report.html",
		"report.HTM",
		"document.pdf",
		"image.png",
		"archive.zip",
		"program.exe",
		"link.lnk",
	])
		assert.equal(fileLinkPreviewKind(path), null, path);
	for (const name of ["README.md", "main.ts", "document.pdf", "image.png"])
		assert.ok(resolveMarkdownFileUrl(`file:///tmp/${name}`));
});
