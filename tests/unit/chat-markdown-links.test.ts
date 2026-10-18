import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown, defaultUrlTransform } from "streamdown";

import { resolveMarkdownFileUrl } from "../../src/lib/chat/chat-markdown-links.ts";
import {
	MARKDOWN_COMPONENTS,
	MARKDOWN_REHYPE_PLUGINS,
} from "../../src/components/chat/chat-markdown-components.tsx";
import { openFileLink } from "../../src/lib/api/file-links.ts";
import { initializeI18n } from "../../src/i18n/index.ts";
import {
	markdownSearchText,
	searchTextMatches,
} from "../../src/lib/chat/chat-search-text.ts";

await initializeI18n("en-US");

test("file links support HTML reports, Unicode, spaces and Windows drive paths", () => {
	for (const url of [
		"file:///Users/example/.answer-me-with-html/pages/report.html",
		"file:///tmp/报告 page.html",
		"file:///C:/Users/example/My%20Pages/report.HTM",
		"file://localhost/tmp/report.html",
		"FILE:///tmp/report.html",
	]) {
		assert.equal(resolveMarkdownFileUrl(url), new URL(url).href);
	}
});

test("file links reject network paths and malformed URLs", () => {
	for (const url of [
		"https://example.com/report.html",
		"javascript:alert(1)",
		"data:text/html,hello",
		"/tmp/report.html",
		"file:report.html",
		"file://server/share/report.html",
		"file:////server/share/report.html",
		"file://user:password@localhost/report.html",
		"file:///tmp/report.html/",
		"file:///tmp/report.html?x=1",
		"file:///tmp/report.html#section",
		"file:///tmp/report.html?",
		"file:///tmp/report.html#",
		"file:///tmp/report%00.html",
		"file:///tmp/report%0a.html",
		"file:///tmp/report\n.html",
		"file:///tmp/report%.html",
		"file:///tmp/%2fserver/report.html",
		"file:///tmp/%5cserver/report.html",
		"file:///C:/report.exe:payload.html",
		"file:///tmp/report\\page.html",
		`file:///tmp/${"x".repeat(4096)}.html`,
	]) {
		assert.equal(resolveMarkdownFileUrl(url), null, url);
	}
});

function renderMarkdown(text: string, mode: "static" | "streaming" = "static") {
	return renderToStaticMarkup(
		createElement(
			Streamdown,
			{
				mode,
				components: MARKDOWN_COMPONENTS,
				urlTransform: defaultUrlTransform,
				rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
			},
			text,
		),
	);
}

test("file reports survive sanitize and harden without a navigable file href", () => {
	for (const mode of ["static", "streaming"] as const) {
		for (const text of [
			"[查看报告](file:///Users/example/report.html)",
			'<a href="file:///Users/example/report.html">查看报告</a>',
		]) {
			const html = renderMarkdown(text, mode);
			assert.match(html, /<button[^>]+type="button"/);
			assert.match(html, /title="file:\/\/\/Users\/example\/report.html"/);
			assert.match(html, /<span[^>]*>查看报告<\/span>/);
			assert.doesNotMatch(html, /href="(?:file:|https:\/\/pilo.invalid)/);
			assert.doesNotMatch(html, /\[blocked\]/);
		}
	}
});

test("raw file URL labels become decoded filenames in static and streaming Markdown", () => {
	for (const mode of ["static", "streaming"] as const) {
		for (const url of [
			"file:///Users/example/My%20Pages/%E6%8A%A5%E5%91%8A%20page.html",
			"file:///C:/Users/example/report.HTM",
		]) {
			const html = renderMarkdown(`[${url}](${url})`, mode);
			const filename = decodeURIComponent(
				new URL(url).pathname.split("/").at(-1) ?? "",
			);
			assert.ok(html.includes(`>${filename}</span>`));
			assert.doesNotMatch(html, />file:\/\//);
			assert.match(html, /title="file:\/\//);
			assert.match(html, /aria-hidden="true"/);
		}
	}
});

test("custom and formatted report labels stay intact, including invalid targets", () => {
	assert.match(
		renderMarkdown("[**Read report**](file:///tmp/report.html)"),
		/data-streamdown="strong">Read report<\/span>/,
	);
	assert.match(
		renderMarkdown("[Read report](file:///tmp/report.exe)"),
		/<span[^>]*>Read report<\/span>/,
	);
});

test("file chips and search share labels and preserve both Report occurrences", () => {
	for (const markdown of [
		"[Report](file:///tmp/report.html) Report",
		'<a href="file:///tmp/report.html">Report</a> Report',
	]) {
		assert.equal(
			searchTextMatches(markdownSearchText(markdown), "Report").length,
			2,
		);
		assert.match(
			renderMarkdown(markdown),
			/<button[^>]*data-chat-search-reference=""/,
		);
	}
	const url = "file:///tmp/private-folder/My%20Report.html";
	assert.equal(markdownSearchText(`[${url}](${url})`), "My Report.html");
	assert.equal(
		searchTextMatches(markdownSearchText(`[${url}](${url})`), "private-folder")
			.length,
		0,
	);
	assert.equal(markdownSearchText(`[**${url}**](${url})`), url);
	assert.equal(markdownSearchText(`[Custom label](${url})`), "Custom label");
	assert.equal(
		markdownSearchText(
			`[file://server/report.html](file://server/report.html)`,
		),
		"file://server/report.html",
	);
});

test("ordinary links and sanitization stay intact, including spoofed metadata", () => {
	const ordinary = renderMarkdown(
		"[Site](https://example.com) [Mail](mailto:a@example.com)",
	);
	assert.match(ordinary, /href="https:\/\/example.com\/"/);
	assert.match(ordinary, /href="mailto:a@example.com"/);
	assert.match(ordinary, /rel="[^"]*noopener noreferrer[^"]*"/);
	assert.match(ordinary, /target="_blank"/);
	const unsafe = renderMarkdown(
		'<a href="javascript:alert(1)" data-pilo-file-url="file:///tmp/a.html" onclick="alert(1)">Unsafe</a><script>alert(1)</script><img src="file:///tmp/a.html">',
	);
	assert.doesNotMatch(
		unsafe,
		/<button|onclick=|<script|javascript:|src="file:/,
	);
});

test("WebUI refuses file opening before any desktop IPC", async () => {
	await assert.rejects(
		openFileLink(null, "file:///tmp/report.html"),
		/File links are not supported in WebUI yet/,
	);
});
