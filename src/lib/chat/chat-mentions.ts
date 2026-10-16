import {
	sessionMentionValue,
	type SessionMention,
} from "@/lib/chat/session-mentions";

export type ChatMention =
	| { kind: "session"; path: string; session: SessionMention }
	| { kind: "file"; path: string };

export function fileMentionName(path: string) {
	return path.split(/[\\/]/).pop() || path;
}

/** Quoted relative paths distinguish completed file picks from an active @ query. */
export function fileMentionValue(path: string) {
	return `@"${path}"`;
}

export function fileMentionPath(value: string): string | null {
	if (!value.startsWith('@"') || !value.endsWith('"')) return null;
	const path = value.slice(2, -1);
	if (!path || /[\r\n"]/.test(path) || /^(?:[/\\~]|[a-z]:[/\\])/i.test(path))
		return null;
	return path;
}

export function readChatMentionDraft(
	value: string,
	sessions: ReadonlyMap<string, SessionMention>,
) {
	const lines = value.split("\n");
	let referenceStart = lines.length;
	const references: ChatMention[] = [];
	const seen = new Set<string>();
	while (referenceStart > 0) {
		const line = lines[referenceStart - 1];
		const session = sessions.get(line);
		const path = session?.path ?? fileMentionPath(line);
		if (!path) break;
		references.push(
			session ? { kind: "session", path, session } : { kind: "file", path },
		);
		referenceStart -= 1;
	}
	// oxlint-disable-next-line unicorn/no-array-reverse -- Reverse a local array; the app targets ES2020.
	references.reverse();
	return {
		references: references.filter((mention) => {
			const key = `${mention.kind}:${mention.path}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}),
		text: lines.slice(0, referenceStart).join("\n"),
	};
}

export function writeChatMentionDraft(
	references: readonly ChatMention[],
	text: string,
) {
	const values = [
		...new Set(
			references.map((mention) =>
				mention.kind === "session"
					? sessionMentionValue(mention.path)
					: fileMentionValue(mention.path),
			),
		),
	];
	return values.length
		? `${text ? `${text}\n` : ""}${values.join("\n")}`
		: text;
}
