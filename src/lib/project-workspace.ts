export type WorkspaceFile = {
	path: string;
	content: string;
	html?: string | null;
};

export type ProjectWorkspace = {
	files: readonly WorkspaceFile[];
	activePath: string | null;
};

export const EMPTY_PROJECT_WORKSPACE: ProjectWorkspace = {
	files: [],
	activePath: null,
};

export function workspaceFileKey(path: string): string {
	// Windows canonicalize returns a verbatim drive path (\\\\?\\C:\\...), while links/sidebar use C:/....
	const normalized = path
		.replace(/\\/g, "/")
		.replace(/^\/\/\?\/([a-z]:\/)/i, "$1");
	return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

type WorkspaceAction =
	| { type: "open"; projectId: string; file: WorkspaceFile }
	| { type: "select"; projectId: string; path: string | null }
	| { type: "close"; projectId: string; path: string }
	| {
			type: "highlight";
			projectId: string;
			file: WorkspaceFile;
			html: string | null;
	  }
	| { type: "prune"; projectIds: readonly string[] };

export function reduceProjectWorkspaces(
	state: ReadonlyMap<string, ProjectWorkspace>,
	action: WorkspaceAction,
): ReadonlyMap<string, ProjectWorkspace> {
	if (action.type === "prune") {
		const valid = new Set(action.projectIds);
		if (Array.from(state.keys()).every((id) => valid.has(id))) return state;
		return new Map(Array.from(state).filter(([id]) => valid.has(id)));
	}
	const current = state.get(action.projectId) ?? EMPTY_PROJECT_WORKSPACE;
	let next: ProjectWorkspace;
	switch (action.type) {
		case "open": {
			const key = workspaceFileKey(action.file.path);
			const existing = current.files.find(
				(file) => workspaceFileKey(file.path) === key,
			);
			next = {
				files: existing ? current.files : [...current.files, action.file],
				activePath: existing?.path ?? action.file.path,
			};
			break;
		}
		case "select": {
			if (
				action.path !== null &&
				!current.files.some((file) => file.path === action.path)
			)
				return state;
			if (current.activePath === action.path) return state;
			next = { ...current, activePath: action.path };
			break;
		}
		case "close": {
			const index = current.files.findIndex(
				(file) => file.path === action.path,
			);
			if (index < 0) return state;
			const files = current.files.filter((file) => file.path !== action.path);
			next = {
				files,
				activePath:
					current.activePath === action.path
						? (files[Math.min(index, files.length - 1)]?.path ?? null)
						: current.activePath,
			};
			break;
		}
		case "highlight": {
			if (!current.files.includes(action.file)) return state;
			next = {
				...current,
				files: current.files.map((file) =>
					file === action.file
						? Object.assign({}, file, { html: action.html })
						: file,
				),
			};
			break;
		}
	}
	return new Map(state).set(action.projectId, next);
}
