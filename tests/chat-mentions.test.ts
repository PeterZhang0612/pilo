import assert from "node:assert/strict";
import test from "node:test";

import {
	fileMentionPath,
	fileMentionValue,
	readChatMentionDraft,
	writeChatMentionDraft,
	type ChatMention,
} from "../src/lib/chat-mentions.ts";
import { createChatSubmission } from "../src/lib/chat-submission.ts";
import {
	sessionMentionValue,
	type SessionMention,
} from "../src/lib/session-mentions.ts";

const session: SessionMention = {
	connectionId: "local",
	projectId: "pilo",
	path: String.raw`C:\Users\Dev User\sessions\session.jsonl`,
	title: "Previous discussion",
	projectName: "Pilo",
	updatedAt: 1,
};
const sessions = new Map([[sessionMentionValue(session.path), session]]);
const file: ChatMention = { kind: "file", path: "src/chat composer.tsx" };
const sessionReference: ChatMention = {
	kind: "session",
	path: session.path,
	session,
};

test("completed file picks stay ordinary quoted Pi paths, including spaces and Unicode", () => {
	for (const path of [
		"README",
		".gitignore",
		"src/index.ts",
		"docs/设计 notes.md",
	]) {
		assert.equal(fileMentionPath(fileMentionValue(path)), path);
		const reference: ChatMention = { kind: "file", path };
		assert.deepEqual(
			readChatMentionDraft(writeChatMentionDraft([reference], ""), sessions),
			{
				references: [reference],
				text: "",
			},
		);
	}
});

test("file and session chips round-trip in either order without changing body text", () => {
	for (const references of [
		[file, sessionReference],
		[sessionReference, file],
	]) {
		const text = "Please check this.\n\nKeep this line. ";
		assert.deepEqual(
			readChatMentionDraft(writeChatMentionDraft(references, text), sessions),
			{
				references,
				text,
			},
		);
	}
});

test("body-start Backspace can remove the last mixed reference atomically", () => {
	const draft = readChatMentionDraft(
		writeChatMentionDraft([file, sessionReference], "body"),
		sessions,
	);
	const next = writeChatMentionDraft(draft.references.slice(0, -1), draft.text);
	assert.deepEqual(readChatMentionDraft(next, sessions), {
		references: [file],
		text: "body",
	});
	assert.equal(writeChatMentionDraft([], "body"), "body");
});

test("repeated file picks do not produce duplicate chips or reference lines", () => {
	assert.equal(
		writeChatMentionDraft([file, file], "body"),
		'body\n@"src/chat composer.tsx"',
	);
	assert.deepEqual(
		readChatMentionDraft(
			`body\n${fileMentionValue(file.path)}\n${sessionMentionValue(session.path)}\n${fileMentionValue(file.path)}`,
			sessions,
		),
		{ references: [file, sessionReference], text: "body" },
	);
});

test("typing @ queries, old inline mentions and unknown session paths remain literal", () => {
	for (const text of [
		"@",
		"@src/index.ts",
		'Please read @"src/index.ts"',
		"@/sessions/deleted.jsonl",
		'@"/sessions/deleted session.jsonl"',
		'@"~/sessions/deleted.jsonl"',
		String.raw`@"C:\Users\Dev User\sessions\deleted.jsonl"`,
		'@"unfinished',
		'@""',
	]) {
		assert.deepEqual(readChatMentionDraft(text, sessions), {
			references: [],
			text,
		});
	}
});

test("session-only drafts remain compatible and slash commands keep their prefix", () => {
	const text = writeChatMentionDraft([sessionReference], "/skill:review");
	assert.equal(text, `/skill:review\n${sessionMentionValue(session.path)}`);
	assert.deepEqual(readChatMentionDraft(text, sessions), {
		references: [sessionReference],
		text: "/skill:review",
	});
	assert.equal(
		createChatSubmission(writeChatMentionDraft([file], "/skill:review")).text,
		'/skill:review \n@"src/chat composer.tsx"',
	);
});
