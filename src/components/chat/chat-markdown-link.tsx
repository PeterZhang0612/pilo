import { ArrowUpRight, FileCode2 } from "lucide-react";
import {
	createContext,
	useContext,
	useState,
	type ComponentPropsWithoutRef,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Project } from "@/lib/api/projects";
import { ProjectWorkspaceContext } from "@/components/app/project-workspace-context";
import { openFileLink } from "@/lib/api/file-links";
import { resolveMarkdownFileUrl } from "@/lib/chat/chat-markdown-links";
import { workspaceFileKey } from "@/lib/project-workspace";

export const ChatMarkdownLinkScope = createContext<Pick<
	Project,
	"id" | "connection"
> | null>(null);

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & {
	node?: unknown;
	"data-pilo-file-url"?: string;
};

export function MarkdownLink({
	children,
	rel,
	node: _node,
	"data-pilo-file-url": fileUrl,
	...props
}: MarkdownLinkProps) {
	const { t } = useTranslation();
	const project = useContext(ChatMarkdownLinkScope);
	const workspace = useContext(ProjectWorkspaceContext);
	const [opening, setOpening] = useState(false);
	if (fileUrl !== undefined) {
		const url = resolveMarkdownFileUrl(fileUrl);
		return (
			<button
				type="button"
				title={fileUrl}
				disabled={opening}
				aria-busy={opening}
				data-chat-search-reference=""
				className="inline-flex min-h-8 min-w-0 max-w-full cursor-pointer touch-manipulation items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2 py-1 align-middle text-left text-sm font-medium text-foreground no-underline transition-colors hover:bg-hover disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
				onClick={() => {
					if (!url) {
						toast.error(t("chat.fileLinkInvalid"));
						return;
					}
					const path = decodeURIComponent(new URL(url).pathname).replace(
						/^\/([a-z]:\/)/i,
						"$1",
					);
					const existing =
						project &&
						workspace?.state
							.get(project.id)
							?.files.find(
								(file) =>
									workspaceFileKey(file.path) === workspaceFileKey(path),
							);
					if (existing && project && workspace) {
						workspace.selectFile(project.id, existing.path);
						return;
					}
					setOpening(true);
					void openFileLink(project, url)
						.then((file) => {
							if (!file || !project) return;
							if (!workspace) throw new Error(t("file.workspaceUnavailable"));
							workspace.openFile(project.id, file);
						})
						.catch((error: unknown) => {
							toast.error(t("chat.fileLinkOpenFailed"), {
								description:
									error instanceof Error
										? error.message
										: t("chat.fileLinkCheckPath"),
							});
						})
						.finally(() => setOpening(false));
				}}
			>
				<FileCode2
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="min-w-0 truncate">{children}</span>
				<ArrowUpRight
					aria-hidden="true"
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
			</button>
		);
	}
	return (
		<a
			{...props}
			target="_blank"
			rel={`${rel ?? ""} noopener noreferrer`.trim()}
		>
			{children}
		</a>
	);
}
