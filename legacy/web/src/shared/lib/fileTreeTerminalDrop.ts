export const FILE_TREE_TERMINAL_DROP_MIME =
	"application/x-2code-file-tree-paths";
export const FILE_TREE_TERMINAL_DROP_EVENT = "2code:file-tree-terminal-drop";
export const FILE_TREE_TERMINAL_DROP_TARGET_ATTR =
	"data-file-tree-terminal-drop-target";
const FILE_TREE_TERMINAL_DROP_TARGET_SELECTOR =
	`[${FILE_TREE_TERMINAL_DROP_TARGET_ATTR}]`;

const FILE_TREE_TERMINAL_DROP_SOURCE = "2code-file-tree";

export interface FileTreeTerminalDropPayload {
	source: typeof FILE_TREE_TERMINAL_DROP_SOURCE;
	profileId: string;
	rootPath: string;
	relativePaths: string[];
	absolutePaths: string[];
}

export interface FileTreeTerminalDropEventDetail {
	clientX: number;
	clientY: number;
	payload: FileTreeTerminalDropPayload;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function getFileTreeTerminalDropTargetAtPoint(
	clientX: number,
	clientY: number,
) {
	return document.elementFromPoint?.(clientX, clientY)?.closest<HTMLElement>(
		FILE_TREE_TERMINAL_DROP_TARGET_SELECTOR,
	) ?? null;
}

export function createFileTreeTerminalDropPayload({
	profileId,
	rootPath,
	relativePaths,
	absolutePaths,
}: Omit<FileTreeTerminalDropPayload, "source">): FileTreeTerminalDropPayload {
	return {
		source: FILE_TREE_TERMINAL_DROP_SOURCE,
		profileId,
		rootPath,
		relativePaths,
		absolutePaths,
	};
}

export function hasFileTreeTerminalDropPayload(
	dataTransfer: DataTransfer | null,
) {
	if (!dataTransfer) return false;
	return Array.from(dataTransfer.types).includes(FILE_TREE_TERMINAL_DROP_MIME);
}

export function writeFileTreeTerminalDropPayload(
	dataTransfer: DataTransfer,
	payload: FileTreeTerminalDropPayload,
) {
	try {
		dataTransfer.effectAllowed = "copyMove";
	} catch {
		// WebKit can expose readonly DataTransfer effect fields for some drag paths.
	}
	dataTransfer.setData(
		FILE_TREE_TERMINAL_DROP_MIME,
		JSON.stringify(payload),
	);
	dataTransfer.setData("text/plain", payload.absolutePaths.join("\n"));
}

export function readFileTreeTerminalDropPayload(
	dataTransfer: DataTransfer | null,
): FileTreeTerminalDropPayload | null {
	if (!dataTransfer || !hasFileTreeTerminalDropPayload(dataTransfer)) {
		return null;
	}

	try {
		const rawPayload = dataTransfer.getData(FILE_TREE_TERMINAL_DROP_MIME);
		if (!rawPayload) return null;

		const payload = JSON.parse(rawPayload) as Partial<FileTreeTerminalDropPayload>;
		if (
			payload.source !== FILE_TREE_TERMINAL_DROP_SOURCE ||
			typeof payload.profileId !== "string" ||
			typeof payload.rootPath !== "string" ||
			!isStringArray(payload.relativePaths) ||
			!isStringArray(payload.absolutePaths) ||
			payload.absolutePaths.length === 0 ||
			payload.relativePaths.length !== payload.absolutePaths.length
		) {
			return null;
		}

		return payload as FileTreeTerminalDropPayload;
	} catch {
		return null;
	}
}

export function formatTerminalPathInput(paths: readonly string[]) {
	return paths
		.filter((path) => path.length > 0)
		.join(" ");
}
