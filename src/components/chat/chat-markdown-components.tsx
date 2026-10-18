import type { ComponentPropsWithoutRef } from "react";
import type { PluggableList, Plugin } from "unified";
import type { Options as SanitizeSchema } from "rehype-sanitize";
import { defaultRehypePlugins, type Components } from "streamdown";
import { rehypeProjectImages } from "@/lib/chat/chat-markdown-images";
import { MarkdownImage } from "@/components/chat/chat-markdown-image";
import { MarkdownLink } from "@/components/chat/chat-markdown-link";
import { rehypeFileLinks } from "@/lib/chat/chat-markdown-links";
import { cn } from "@/lib/utils";

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
	node?: unknown;
	inline?: boolean;
};
type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & {
	node?: unknown;
};

function MarkdownInlineCode({
	className,
	children,
	style: _style,
	node: _node,
	inline: _inline,
	...props
}: MarkdownCodeProps) {
	return (
		<code
			{...props}
			className={cn(
				"rounded-sm bg-code px-1 py-px font-mono [font-size:var(--pilo-code-font-size)] text-code-foreground ring-1 ring-inset ring-border/50",
				className,
			)}
		>
			{children}
		</code>
	);
}

function MarkdownTable({ node: _node, ...props }: MarkdownTableProps) {
	return (
		<div
			data-markdown-table
			className="scrollbar-pro my-3 overflow-x-auto rounded-lg border border-border/70 bg-background"
		>
			<table {...props} />
		</div>
	);
}

// Streamdown exposes this configured tuple only as the wider Pluggable type.
const [sanitize, sanitizeSchema] = defaultRehypePlugins.sanitize as [
	Plugin<[SanitizeSchema]>,
	SanitizeSchema,
];

export const MARKDOWN_REHYPE_PLUGINS = [
	defaultRehypePlugins.raw,
	[
		sanitize,
		{
			...sanitizeSchema,
			protocols: {
				...sanitizeSchema.protocols,
				href: [...(sanitizeSchema.protocols?.href ?? []), "file"],
			},
		},
	],
	rehypeFileLinks,
	rehypeProjectImages,
	defaultRehypePlugins.harden,
] satisfies PluggableList;

export const MARKDOWN_COMPONENTS = {
	a: MarkdownLink,
	img: MarkdownImage,
	inlineCode: MarkdownInlineCode,
	table: MarkdownTable,
} satisfies Components;
