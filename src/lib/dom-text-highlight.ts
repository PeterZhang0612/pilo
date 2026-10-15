/**
 * 会话内查找的字符级高亮，基于 CSS Custom Highlight API。
 * 不改 Markdown 渲染管线、不产生额外 DOM 节点，虚拟列表里的已挂载行才生效。
 */

import type { ChatMessageMatch } from "./chat-message-search";
import {
	SEARCH_BLOCK_TAGS,
	SEARCH_IGNORED_TAGS,
	searchTextMatches,
} from "./chat-search-text";

const ALL_HIGHLIGHT = "pilo-find";
const ACTIVE_HIGHLIGHT = "pilo-find-active";

function highlightApi() {
	if (
		typeof CSS === "undefined" ||
		!CSS.highlights ||
		typeof Highlight !== "function"
	) {
		return null;
	}
	return { highlights: CSS.highlights, Highlight };
}

export function clearTextHighlight(): void {
	const api = highlightApi();
	api?.highlights.delete(ALL_HIGHLIGHT);
	api?.highlights.delete(ACTIVE_HIGHLIGHT);
}

/** Match visible text across inline/ syntax-highlight token boundaries. */
function matchRangesInElement(element: Element, query: string): Range[] {
	const parts: string[] = [];
	const chunks: Array<{ node: Node; start: number; end: number }> = [];
	let length = 0;
	const append = (text: string) => {
		parts.push(text);
		length += text.length;
	};
	const visit = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.nodeValue ?? "";
			if (text) chunks.push({ node, start: length, end: length + text.length });
			append(text);
			return;
		}
		if (!(node instanceof Element)) return;
		const reference = node.hasAttribute("data-chat-search-reference");
		if (
			(SEARCH_IGNORED_TAGS.has(node.localName) && !reference) ||
			node.matches(
				'[hidden], [aria-hidden="true"], [data-streamdown="code-block-header"], [data-streamdown="code-block-actions"]',
			)
		)
			return;
		// Streamdown renders code lines as block spans without newline text nodes.
		const boundary =
			reference ||
			SEARCH_BLOCK_TAGS.has(node.localName) ||
			node.matches('[data-streamdown="code-block-body"] > pre > code > span');
		if (boundary) append("\n");
		for (const child of node.childNodes) visit(child);
		if (boundary) append("\n");
	};
	visit(element);
	const ranges: Range[] = [];
	let chunkIndex = 0;
	for (const match of searchTextMatches(parts.join(""), query)) {
		while (chunks[chunkIndex] && chunks[chunkIndex].end <= match.start) {
			chunkIndex += 1;
		}
		const start = chunks[chunkIndex];
		let endIndex = chunkIndex;
		while (chunks[endIndex] && chunks[endIndex].end < match.end) endIndex += 1;
		const end = chunks[endIndex];
		if (!start || !end) continue;
		const range = document.createRange();
		range.setStart(start.node, match.start - start.start);
		range.setEnd(end.node, match.end - end.start);
		ranges.push(range);
	}
	return ranges;
}

/**
 * 在 `container` 内按 `query` 重算高亮：全部命中弱高亮，active 命中强高亮。
 * `active` 以消息、文本段与段内可见命中序号定位。
 * 返回 active 命中是否已在 DOM 中找到（供调用方决定是否重试）。
 */
export function applyTextHighlight(
	container: ParentNode,
	query: string,
	active?: ChatMessageMatch,
	scrollActive = false,
): boolean {
	const api = highlightApi();
	if (!api) return false;
	api.highlights.delete(ALL_HIGHLIGHT);
	api.highlights.delete(ACTIVE_HIGHLIGHT);
	if (!query.trim()) return false;

	const all: Range[] = [];
	let activeRange: Range | undefined;
	for (const element of container.querySelectorAll("[data-message-id]")) {
		const sections =
			element.getAttribute("data-message-role") === "assistant"
				? element.querySelectorAll("[data-chat-search-content-id]")
				: [element];
		let occurrenceIndex = 0;
		for (const section of sections) {
			const ranges = matchRangesInElement(section, query);
			all.push(...ranges);
			if (
				active &&
				element.getAttribute("data-message-id") === active.messageId
			) {
				if (active.contentId !== undefined) {
					if (
						section.getAttribute("data-chat-search-content-id") ===
						active.contentId
					) {
						activeRange = ranges[active.contentOccurrenceIndex ?? 0];
					}
				} else {
					activeRange ??= ranges[active.occurrenceIndex - occurrenceIndex];
				}
			}
			occurrenceIndex += ranges.length;
		}
	}
	if (all.length > 0)
		api.highlights.set(ALL_HIGHLIGHT, new api.Highlight(...all));
	if (activeRange) {
		api.highlights.set(ACTIVE_HIGHLIGHT, new api.Highlight(activeRange));
		if (scrollActive) {
			const viewport =
				activeRange.startContainer.parentElement?.closest(".chat-scrollbar");
			if (viewport) {
				const rect = activeRange.getBoundingClientRect();
				const viewportRect = viewport.getBoundingClientRect();
				viewport.scrollTop +=
					rect.top - viewportRect.top - viewport.clientHeight / 2;
			}
		}
	}
	return Boolean(activeRange);
}
