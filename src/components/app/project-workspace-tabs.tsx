import { useContext, useEffect, useRef, type ReactNode } from "react";
import {
	File,
	FileCode2,
	FileCog,
	FileJson2,
	FileText,
	Palette,
	SquareTerminal,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { ProjectWorkspaceContext } from "@/components/app/project-workspace-context";
import { EMPTY_PROJECT_WORKSPACE } from "@/lib/project-workspace";
import { cn } from "@/lib/utils";
import { Hint } from "@/ui/tooltip";

function WorkspaceFileIcon({ path }: { path: string }) {
	const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	let Icon = FileCode2;
	if (
		/\.(?:md|markdown|txt|log)$/.test(name) ||
		/^(?:readme|license)$/.test(name)
	)
		Icon = FileText;
	else if (/\.(?:json|jsonc|json5)$/.test(name)) Icon = FileJson2;
	else if (
		/\.(?:ya?ml|toml|ini|conf|cfg)$/.test(name) ||
		/^\.env(?:\.|$)/.test(name) ||
		/^(?:\.gitignore|\.dockerignore)$/.test(name)
	)
		Icon = FileCog;
	else if (
		/\.(?:sh|bash|zsh|fish|ps1|psm1|bat|cmd)$/.test(name) ||
		/^(?:dockerfile|makefile)$/.test(name)
	)
		Icon = SquareTerminal;
	else if (/\.(?:css|scss|sass|less)$/.test(name)) Icon = Palette;
	else if (!name.includes(".")) Icon = File;
	return <Icon aria-hidden="true" className="size-4 shrink-0" />;
}

export function ProjectWorkspaceTabs({
	projectId,
	title,
	temporary,
	children,
}: {
	projectId?: string;
	title?: string;
	temporary?: boolean;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const workspace = useContext(ProjectWorkspaceContext);
	const { files, activePath } =
		(projectId ? workspace?.state.get(projectId) : undefined) ??
		EMPTY_PROJECT_WORKSPACE;
	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const tabs =
			listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		const selected = Array.from(tabs ?? []).find(
			(tab) => (tab.dataset.filePath ?? null) === activePath,
		);
		if (!selected || !listRef.current) return;
		const reveal = () => {
			if (getComputedStyle(selected).visibility === "hidden") return;
			// Reveal the close button too, including after a narrow-window resize.
			const target = activePath === null ? selected : selected.parentElement;
			target?.scrollIntoView({ block: "nearest", inline: "nearest" });
		};
		if (
			activePath !== null &&
			getComputedStyle(selected).visibility !== "hidden"
		) {
			selected.focus({ preventScroll: true });
		}
		reveal();
		const observer = new ResizeObserver(reveal);
		observer.observe(listRef.current);
		return () => observer.disconnect();
	}, [activePath]);
	const select = (path: string | null) => {
		if (projectId) workspace?.selectFile(projectId, path);
	};
	const close = (path: string) => {
		if (projectId) workspace?.closeFile(projectId, path);
		requestAnimationFrame(() =>
			listRef.current
				?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
				?.focus({ preventScroll: true }),
		);
	};
	if (!title && files.length === 0) return <div className="min-w-0 flex-1" />;
	const chatTitle = title || t("app.newChat");
	const tabClass =
		"flex min-h-8 min-w-0 items-center gap-1.5 rounded-md border px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11";
	return (
		<div
			ref={listRef}
			role="tablist"
			tabIndex={-1}
			aria-label={t("file.workspaceTabs")}
			className="scrollbar-pro flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
			onKeyDown={(event) => {
				if (
					!(event.target instanceof HTMLButtonElement) ||
					event.target.getAttribute("role") !== "tab"
				)
					return;
				if (event.key === "Delete" && event.target.dataset.filePath) {
					event.preventDefault();
					close(event.target.dataset.filePath);
					return;
				}
				const tabs = Array.from(
					listRef.current?.querySelectorAll<HTMLButtonElement>(
						'[role="tab"]',
					) ?? [],
				);
				const current = tabs.indexOf(event.target);
				let index: number;
				switch (event.key) {
					case "ArrowRight":
						index = (current + 1) % tabs.length;
						break;
					case "ArrowLeft":
						index = (current - 1 + tabs.length) % tabs.length;
						break;
					case "Home":
						index = 0;
						break;
					case "End":
						index = tabs.length - 1;
						break;
					default:
						return;
				}
				event.preventDefault();
				tabs[index]?.focus();
				tabs[index]?.click();
			}}
		>
			<Hint label={chatTitle}>
				<button
					type="button"
					role="tab"
					aria-selected={activePath === null}
					tabIndex={activePath === null ? 0 : -1}
					onClick={() => select(null)}
					className={cn(
						tabClass,
						files.length ? "min-w-24 max-w-56" : "max-w-[66.666667%]",
						temporary ? "border-dashed border-border" : "border-transparent",
						activePath === null
							? "text-foreground"
							: "text-muted-foreground hover:bg-hover",
						files.length > 0 && activePath === null && "bg-muted/60",
					)}
				>
					{children}
					<span className="min-w-0 truncate">{chatTitle}</span>
				</button>
			</Hint>
			{files.map((file) => (
				<div
					key={file.path}
					role="presentation"
					onMouseDown={(event) => {
						// Suppress native middle-button autoscroll/paste before auxclick.
						if (event.button === 1) event.preventDefault();
					}}
					onAuxClick={(event) => {
						if (event.button !== 1) return;
						event.preventDefault();
						close(file.path);
					}}
					className={cn(
						"flex min-w-28 max-w-56 items-center rounded-md ring-1 ring-inset hover:bg-hover",
						activePath === file.path
							? "bg-muted/60 ring-border"
							: "ring-border/60",
					)}
				>
					<Hint label={file.path}>
						<button
							type="button"
							role="tab"
							data-file-path={file.path}
							aria-selected={activePath === file.path}
							tabIndex={activePath === file.path ? 0 : -1}
							onClick={() => select(file.path)}
							className={cn(
								tabClass,
								"flex-1 border-transparent pr-1",
								activePath === file.path
									? "text-foreground"
									: "text-muted-foreground",
							)}
						>
							<WorkspaceFileIcon path={file.path} />
							<span className="min-w-0 truncate">
								{file.path.split(/[\\/]/).at(-1)}
							</span>
						</button>
					</Hint>
					<button
						type="button"
						aria-label={t("file.closeFile", {
							name: file.path.split(/[\\/]/).at(-1) ?? file.path,
						})}
						onClick={() => close(file.path)}
						className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:size-11"
					>
						<X aria-hidden="true" className="size-3.5" />
					</button>
				</div>
			))}
		</div>
	);
}
