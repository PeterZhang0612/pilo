import { resolveChatImageMimeType } from "@/lib/chat-submission";

export type MarkdownImageSource =
	| { type: "external"; url: string }
	| { type: "project"; path: string; mimeType: string }
	| { type: "invalid" };

/** Markdown paths are project-relative, never browser-relative or system paths. */
export function resolveMarkdownImageSource(src?: string): MarkdownImageSource {
	if (!src) return { type: "invalid" };
	if (/^https?:\/\//i.test(src)) {
		try {
			const url = new URL(src);
			if (!url.username && !url.password)
				return { type: "external", url: url.href };
		} catch {
			// Fall through to the invalid-source state.
		}
		return { type: "invalid" };
	}
	let path: string;
	try {
		path = decodeURIComponent(src).replaceAll("\\", "/");
	} catch {
		return { type: "invalid" };
	}
	if (
		path.length > 4096 ||
		path.startsWith("/") ||
		/[:?#]/.test(path) ||
		Array.from(path).some((char) => {
			const code = char.charCodeAt(0);
			return code < 32 || (code >= 127 && code <= 159);
		})
	)
		return { type: "invalid" };
	const segments = path.split("/");
	if (segments.includes("..")) return { type: "invalid" };
	path = segments.filter((segment) => segment && segment !== ".").join("/");
	const mimeType = resolveChatImageMimeType({ name: path, type: "" });
	return path && typeof mimeType === "string"
		? { type: "project", path, mimeType }
		: { type: "invalid" };
}

type ImageNode = {
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: ImageNode[];
};

/** Run after sanitization, before harden rebases relative URLs and removes `..`. */
export function rehypeProjectImages() {
	return (tree: ImageNode) => {
		function visit(node: ImageNode) {
			if (node.tagName === "img") {
				const props = node.properties ?? (node.properties = {});
				const src = typeof props.src === "string" ? props.src : "";
				if (resolveMarkdownImageSource(src).type !== "external") {
					props["data-pilo-image-src"] = src;
					// Only the custom image component consumes this sentinel; never fetch it.
					props.src = "https://pilo.invalid/project-image";
				}
			}
			for (const child of node.children ?? []) visit(child);
		}
		visit(tree);
	};
}
