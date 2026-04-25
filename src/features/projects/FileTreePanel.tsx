import { FileTree, useFileTree } from "@pierre/trees/react";
import { Box, Center, Spinner } from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { Command, open as openShellPath } from "@tauri-apps/plugin-shell";
import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	ContextMenuItem as FileTreeContextMenuItem,
	ContextMenuOpenContext as FileTreeContextMenuOpenContext,
	FileTree as FileTreeModel,
	FileTreeDropContext,
	FileTreeDropResult,
	FileTreeRenameEvent,
	GitStatusEntry,
} from "@pierre/trees";
import * as m from "@/paraglide/messages.js";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { toaster } from "@/shared/providers/Toaster";
import FileTreeDeleteDialog from "./FileTreeDeleteDialog";
import FileTreeNewFolderDialog from "./FileTreeNewFolderDialog";
import FileViewerDialog from "./FileViewerDialog";
import {
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	useFileTreeStore,
} from "./fileTreeStore";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "./fileViewerTabsStore";
import {
	useCreateFileTreeFile,
	useCreateFileTreeFolder,
	useDeleteFileTreePath,
	useFileTreeGitStatus,
	useFileTreePaths,
	useMoveFileTreePaths,
	useRenameFileTreePath,
	useSaveFileContent,
} from "./hooks";
import {
	mintUntitledFilePath,
	NEW_FILE_CANCEL_EVENT,
	type NewFileCancelDetail,
	useFileDraftStore,
	useNewFileSessionStore,
} from "./untitledDrafts";

const FILE_TREE_PANEL_TRANSITION = {
	type: "spring",
	stiffness: 320,
	damping: 34,
	mass: 0.9,
} as const;
const FILE_TREE_CONTENT_TRANSITION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;
const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;
const FILE_TREE_GIT_STATUSES = new Set<GitStatusEntry["status"]>([
	"added",
	"deleted",
	"ignored",
	"modified",
	"renamed",
	"untracked",
]);

const FILE_TREE_HOST_STYLE = {
	flex: 1,
	minHeight: 0,
	minWidth: 0,
	width: "100%",
	"--trees-bg-muted-override": "var(--chakra-colors-bg-subtle)",
	"--trees-bg-override": "transparent",
	"--trees-border-radius-override": "4px",
	"--trees-fg-muted-override": "var(--chakra-colors-fg-muted)",
	"--trees-fg-override": "var(--chakra-colors-fg-muted)",
	"--trees-font-family-override": "inherit",
	"--trees-font-size-override": "13px",
	"--trees-item-margin-x-override": "4px",
	"--trees-item-padding-x-override": "4px",
	"--trees-level-gap-override": "12px",
	"--trees-padding-inline-override": "4px",
	"--trees-selected-bg-override": "var(--chakra-colors-bg-subtle)",
	"--trees-selected-fg-override": "var(--chakra-colors-fg)",
} as CSSProperties;

const FILE_TREE_CONTEXT_MENU_STYLE = {
	position: "absolute",
	top: 0,
	right: 0,
	zIndex: 10,
	display: "grid",
	minWidth: "172px",
	padding: "4px",
	border: "1px solid var(--chakra-colors-border)",
	borderRadius: "6px",
	background: "var(--chakra-colors-bg-panel)",
	boxShadow: "var(--chakra-shadows-md)",
	color: "var(--chakra-colors-fg)",
	fontSize: "13px",
} as CSSProperties;

const FILE_TREE_CONTEXT_MENU_BUTTON_STYLE = {
	appearance: "none",
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-start",
	width: "100%",
	minHeight: "28px",
	padding: "0 8px",
	border: 0,
	borderRadius: "4px",
	background: "transparent",
	color: "inherit",
	cursor: "default",
	font: "inherit",
	textAlign: "left",
} as CSSProperties;

interface FileTreePanelProps {
	profileId: string;
	rootPath: string;
	isOpen: boolean;
	onOpenFile?: (filePath: string) => void;
}

function getTreeItemPath(event: MouseEvent<HTMLElement>) {
	for (const target of event.nativeEvent.composedPath()) {
		if (target instanceof HTMLElement) {
			const itemPath = target.dataset.itemPath;
			if (itemPath) return itemPath;
		}
	}
	return null;
}

function toAbsolutePath(rootPath: string, relativePath: string) {
	const normalizedRoot = rootPath.replace(TRAILING_PATH_SEPARATOR_RE, "");
	return `${normalizedRoot}/${relativePath}`;
}

function isFileTreeGitStatus(status: string): status is GitStatusEntry["status"] {
	return FILE_TREE_GIT_STATUSES.has(status as GitStatusEntry["status"]);
}

function toFileTreeGitStatus(
	entries: readonly { path: string; status: string }[] | undefined,
): GitStatusEntry[] {
	if (!entries) return [];

	return entries.flatMap((entry) => {
		if (!entry.path || !isFileTreeGitStatus(entry.status)) return [];
		return [{ path: entry.path, status: entry.status }];
	});
}

function buildModelPaths(
	treePaths: readonly string[] | undefined,
	gitStatus: readonly GitStatusEntry[],
) {
	const paths = [...(treePaths ?? [])];
	const seenPaths = new Set(paths);
	for (const entry of gitStatus) {
		if (seenPaths.has(entry.path)) continue;
		seenPaths.add(entry.path);
		paths.push(entry.path);
	}
	paths.sort((left, right) =>
		left.localeCompare(right, undefined, { sensitivity: "base" }),
	);
	return paths;
}

function getContextMenuActionPaths(
	itemPath: string,
	selectedPaths: readonly string[],
) {
	return selectedPaths.includes(itemPath) ? selectedPaths : [itemPath];
}

function hasTreePath(pathSet: ReadonlySet<string>, path: string) {
	const directoryPath = `${path.replace(TRAILING_PATH_SEPARATOR_RE, "")}/`;
	return pathSet.has(path) || pathSet.has(directoryPath);
}

interface FileTreeContextMenuButtonProps {
	children: ReactNode;
	disabled?: boolean;
	onClick?: () => void;
	onMouseEnter?: () => void;
	hasSubmenu?: boolean;
	isSubmenuOpen?: boolean;
}

function FileTreeContextMenuButton({
	children,
	disabled = false,
	onClick,
	onMouseEnter,
	hasSubmenu = false,
	isSubmenuOpen = false,
}: FileTreeContextMenuButtonProps) {
	return (
		<button
			disabled={disabled}
			role="menuitem"
			style={{
				...FILE_TREE_CONTEXT_MENU_BUTTON_STYLE,
				opacity: disabled ? 0.45 : 1,
				background: isSubmenuOpen
					? "var(--chakra-colors-bg-subtle)"
					: "transparent",
			}}
			type="button"
			onClick={onClick}
			onMouseEnter={(event) => {
				if (disabled) return;
				event.currentTarget.style.background =
					"var(--chakra-colors-bg-subtle)";
				onMouseEnter?.();
			}}
			onMouseLeave={(event) => {
				if (isSubmenuOpen) return;
				event.currentTarget.style.background = "transparent";
			}}
		>
			<span style={{ flex: 1 }}>{children}</span>
			{hasSubmenu && (
				<span
					aria-hidden="true"
					style={{ marginInlineStart: "8px", opacity: 0.6 }}
				>
					▸
				</span>
			)}
		</button>
	);
}

interface FileTreeContextSubmenuProps {
	children: ReactNode;
}

function FileTreeContextSubmenu({ children }: FileTreeContextSubmenuProps) {
	return (
		<div
			role="menu"
			style={{
				...FILE_TREE_CONTEXT_MENU_STYLE,
				position: "absolute",
				top: 0,
				left: "100%",
				right: "auto",
				marginInlineStart: "2px",
			}}
		>
			{children}
		</div>
	);
}

async function revealAbsolutePathInFinder(absolutePath: string) {
	const isMac = navigator.platform.toUpperCase().includes("MAC");
	const cmd = isMac ? "open" : "explorer";
	const args = isMac ? ["-R", absolutePath] : [absolutePath];
	try {
		await Command.create(cmd, args).execute();
	} catch (error) {
		console.error("Failed to reveal in finder", error);
	}
}

async function openAbsolutePathInDefaultEditor(absolutePath: string) {
	try {
		await openShellPath(absolutePath);
	} catch (error) {
		console.error("Failed to open in default editor", error);
	}
}

interface FileTreeContextMenuProps {
	context: FileTreeContextMenuOpenContext;
	filePathSet: ReadonlySet<string>;
	item: FileTreeContextMenuItem;
	renamablePathSet: ReadonlySet<string>;
	rootPath: string;
	selectedPaths: readonly string[];
	onOpenFile: (relativePath: string) => void;
	onStartRename: (path: string) => void;
	onRequestNewFile: (parentRelativePath: string) => void;
	onRequestNewFolder: (parentRelativePath: string) => void;
	onRequestDelete: (path: string, isFolder: boolean) => void;
	onSuppressNextSelectionOpen: () => void;
}

function FileTreeContextMenu({
	context,
	filePathSet,
	item,
	renamablePathSet,
	rootPath,
	selectedPaths,
	onOpenFile,
	onStartRename,
	onRequestNewFile,
	onRequestNewFolder,
	onRequestDelete,
	onSuppressNextSelectionOpen,
}: FileTreeContextMenuProps) {
	const [openSubmenu, setOpenSubmenu] = useState<"copy-path" | null>(null);
	const actionPaths = getContextMenuActionPaths(item.path, selectedPaths);
	const canOpen = item.kind === "file" && filePathSet.has(item.path);
	const canRename =
		actionPaths.length === 1 && hasTreePath(renamablePathSet, item.path);
	const isFolder = item.kind === "directory";
	const parentRelativePath = isFolder
		? item.path
		: getParentRelativePath(item.path);

	const handleOpen = () => {
		if (canOpen) openAndCloseContextMenu(context, () => onOpenFile(item.path));
	};
	const handleRename = () => {
		if (!canRename) return;
		onSuppressNextSelectionOpen();
		context.close({ restoreFocus: false });
		onStartRename(item.path);
	};
	const handleCopyRelativePath = () => {
		void copyTextToClipboard(actionPaths.join("\n")).catch(() => {});
		context.close();
	};
	const handleCopyAbsolutePath = () => {
		void copyTextToClipboard(
			actionPaths.map((path) => toAbsolutePath(rootPath, path)).join("\n"),
		).catch(() => {});
		context.close();
	};
	const handleRevealInFinder = () => {
		void revealAbsolutePathInFinder(toAbsolutePath(rootPath, item.path));
		context.close();
	};
	const handleOpenInDefaultEditor = () => {
		void openAbsolutePathInDefaultEditor(toAbsolutePath(rootPath, item.path));
		context.close();
	};
	const handleNewFile = () => {
		onSuppressNextSelectionOpen();
		context.close();
		onRequestNewFile(parentRelativePath);
	};
	const handleNewFolder = () => {
		onSuppressNextSelectionOpen();
		context.close();
		onRequestNewFolder(parentRelativePath);
	};
	const handleDelete = () => {
		onSuppressNextSelectionOpen();
		context.close();
		onRequestDelete(item.path, isFolder);
	};

	return (
		<div
			data-file-tree-context-menu-root="true"
			role="menu"
			style={FILE_TREE_CONTEXT_MENU_STYLE}
			onMouseLeave={() => setOpenSubmenu(null)}
		>
			<FileTreeContextMenuButton
				disabled={!canOpen}
				onClick={handleOpen}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuOpen()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				disabled={!canOpen}
				onClick={handleOpenInDefaultEditor}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuOpenInDefaultEditor()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				onClick={handleRevealInFinder}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuRevealInFinder()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				onClick={handleNewFile}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuNewFile()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				onClick={handleNewFolder}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuNewFolder()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				disabled={!canRename}
				onClick={handleRename}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.rename()}
			</FileTreeContextMenuButton>
			<div style={{ position: "relative" }}>
				<FileTreeContextMenuButton
					hasSubmenu
					isSubmenuOpen={openSubmenu === "copy-path"}
					onMouseEnter={() => setOpenSubmenu("copy-path")}
					onClick={() =>
						setOpenSubmenu(
							openSubmenu === "copy-path" ? null : "copy-path",
						)
					}
				>
					{m.fileTreeContextMenuCopyPath()}
				</FileTreeContextMenuButton>
				{openSubmenu === "copy-path" && (
					<FileTreeContextSubmenu>
						<FileTreeContextMenuButton onClick={handleCopyRelativePath}>
							{m.fileTreeContextMenuCopyRelativePath()}
						</FileTreeContextMenuButton>
						<FileTreeContextMenuButton onClick={handleCopyAbsolutePath}>
							{m.fileTreeContextMenuCopyAbsolutePath()}
						</FileTreeContextMenuButton>
					</FileTreeContextSubmenu>
				)}
			</div>
			<FileTreeContextMenuButton
				onClick={handleDelete}
				onMouseEnter={() => setOpenSubmenu(null)}
			>
				{m.fileTreeContextMenuDelete()}
			</FileTreeContextMenuButton>
		</div>
	);
}

function getParentRelativePath(relativePath: string) {
	const trimmed = relativePath.replace(TRAILING_PATH_SEPARATOR_RE, "");
	const lastSeparator = trimmed.lastIndexOf("/");
	if (lastSeparator < 0) return "";
	return trimmed.slice(0, lastSeparator);
}

function joinPlaceholderPath(parent: string, name: string) {
	const trimmedParent = parent.replace(TRAILING_PATH_SEPARATOR_RE, "");
	if (!trimmedParent) return name;
	return `${trimmedParent}/${name}`;
}

function pickUniquePlaceholderPath(
	parent: string,
	existingPaths: ReadonlySet<string>,
) {
	const baseName = "untitled";
	let candidate = joinPlaceholderPath(parent, baseName);
	if (!existingPaths.has(candidate) && !existingPaths.has(`${candidate}/`)) {
		return candidate;
	}
	for (let i = 1; i < 1000; i += 1) {
		candidate = joinPlaceholderPath(parent, `${baseName}-${i}`);
		if (
			!existingPaths.has(candidate)
			&& !existingPaths.has(`${candidate}/`)
		) {
			return candidate;
		}
	}
	return joinPlaceholderPath(parent, `${baseName}-${Date.now()}`);
}

function openAndCloseContextMenu(
	context: FileTreeContextMenuOpenContext,
	callback: () => void,
) {
	callback();
	context.close();
}

export default function FileTreePanel({
	profileId,
	rootPath,
	isOpen,
	onOpenFile,
}: FileTreePanelProps) {
	const [openFilePath, setOpenFilePath] = useState<string | null>(null);
	const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
	const [newFolderParentPath, setNewFolderParentPath] = useState<
		string | null
	>(null);
	const [deleteTarget, setDeleteTarget] = useState<{
		path: string;
		isFolder: boolean;
	} | null>(null);
	const [emptyAreaMenu, setEmptyAreaMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [newFileError, setNewFileError] = useState<string | null>(null);
	const rootPathRef = useRef(rootPath);
	const onOpenFileRef = useRef(onOpenFile);
	const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
	const treePathSetRef = useRef<ReadonlySet<string>>(new Set());
	const modelPathsRef = useRef<readonly string[]>([]);
	const gitStatusRef = useRef<readonly GitStatusEntry[]>([]);
	const modelRef = useRef<FileTreeModel | null>(null);
	const skipNextSelectionOpenRef = useRef(false);
	const restoreModelRef = useRef(() => {});
	const renameFileTreePathRef = useRef((_event: FileTreeRenameEvent) => {});
	const moveFileTreePathsRef = useRef((_event: FileTreeDropResult) => {});
	const pendingNewFilePathRef = useRef<string | null>(null);
	const prefersReducedMotion = useReducedMotion() ?? false;
	const panelWidth = useFileTreeStore((s) => s.panelWidth);
	const setPanelWidth = useFileTreeStore((s) => s.setPanelWidth);
	const resize = useHorizontalResize({
		value: panelWidth,
		min: FILE_TREE_PANEL_MIN_WIDTH,
		max: FILE_TREE_PANEL_MAX_WIDTH,
		disabled: !isOpen,
		onChange: setPanelWidth,
	});

	const { data: treePaths, isLoading } = useFileTreePaths(rootPath, isOpen);
	const { data: gitStatusEntries } = useFileTreeGitStatus(profileId, isOpen);
	const renameFileTreePath = useRenameFileTreePath(rootPath, profileId);
	const moveFileTreePaths = useMoveFileTreePaths(rootPath, profileId);
	const deleteFileTreePath = useDeleteFileTreePath(rootPath, profileId);
	const createFileTreeFolder = useCreateFileTreeFolder(rootPath, profileId);
	const createFileTreeFile = useCreateFileTreeFile(rootPath, profileId);
	const saveFileContent = useSaveFileContent(profileId);
	const openUntitledTab = useFileViewerTabsStore(
		(state) => state.openUntitled,
	);
	const renameFileTab = useFileViewerTabsStore((state) => state.renameTab);
	const closeFileTab = useFileViewerTabsStore((state) => state.closeTab);
	const renameDirty = useFileViewerDirtyStore((state) => state.renameDirty);
	const setFileDirty = useFileViewerDirtyStore((state) => state.setFileDirty);
	const registerNewFileSession = useNewFileSessionStore(
		(state) => state.register,
	);
	const consumeNewFileSession = useNewFileSessionStore(
		(state) => state.consume,
	);
	const gitStatus = useMemo(
		() => toFileTreeGitStatus(gitStatusEntries),
		[gitStatusEntries],
	);
	const modelPaths = useMemo(
		() => buildModelPaths(treePaths, gitStatus),
		[gitStatus, treePaths],
	);
	const filePathSet = useMemo(
		() => new Set((treePaths ?? []).filter((path) => !path.endsWith("/"))),
		[treePaths],
	);
	const treePathSet = useMemo(() => new Set(treePaths ?? []), [treePaths]);

	rootPathRef.current = rootPath;
	onOpenFileRef.current = onOpenFile;
	filePathSetRef.current = filePathSet;
	treePathSetRef.current = treePathSet;
	modelPathsRef.current = modelPaths;
	gitStatusRef.current = gitStatus;

	const openRelativeFile = useCallback((relativePath: string) => {
		const filePath = toAbsolutePath(rootPathRef.current, relativePath);
		if (onOpenFileRef.current) {
			onOpenFileRef.current(filePath);
		} else {
			setOpenFilePath(filePath);
		}
	}, []);

	restoreModelRef.current = () => {
		modelRef.current?.resetPaths(modelPathsRef.current);
		modelRef.current?.setGitStatus(gitStatusRef.current);
	};
	renameFileTreePathRef.current = (event) => {
		const pendingPlaceholder = pendingNewFilePathRef.current;
		if (pendingPlaceholder && event.sourcePath === pendingPlaceholder) {
			pendingNewFilePathRef.current = null;
			const session = consumeNewFileSession(pendingPlaceholder);
			const newAbsolutePath = toAbsolutePath(
				rootPathRef.current,
				event.destinationPath,
			);
			const newTitle =
				event.destinationPath.split("/").pop()
					?? event.destinationPath;

			void createFileTreeFile
				.mutateAsync({ targetPath: event.destinationPath })
				.then(async () => {
					setNewFileError(null);
					if (session) {
						const draftStore = useFileDraftStore.getState();
						const buffer = draftStore.drafts[session.untitledPath];
						const hasBuffer =
							buffer != null && buffer.length > 0;

						// Re-key the open untitled tab to the real path so the
						// editor follows the user's typed filename instead of
						// opening a second tab.
						draftStore.rename(session.untitledPath, newAbsolutePath);
						renameDirty(
							session.profileId,
							session.untitledPath,
							newAbsolutePath,
						);
						renameFileTab(
							session.profileId,
							session.untitledPath,
							newAbsolutePath,
							newTitle,
						);

						if (hasBuffer) {
							try {
								await saveFileContent.mutateAsync({
									path: newAbsolutePath,
									content: buffer,
								});
								useFileDraftStore
									.getState()
									.setSavedValue(newAbsolutePath, buffer);
								setFileDirty(
									session.profileId,
									newAbsolutePath,
									false,
								);
							} catch (err) {
								toaster.create({
									title: "Save failed",
									description:
										err instanceof Error
											? err.message
											: String(err),
									type: "error",
									closable: true,
								});
							}
						} else {
							useFileDraftStore
								.getState()
								.setSavedValue(newAbsolutePath, "");
							setFileDirty(
								session.profileId,
								newAbsolutePath,
								false,
							);
						}
					} else {
						// No untitled session linked (shouldn't normally
						// happen, but fall back to opening the new file).
						openRelativeFile(event.destinationPath);
					}
				})
				.catch((err) => {
					// Backend rejected the create (e.g. a gitignored file
					// already exists at that path on disk and the tree
					// model didn't know about it). Restore the placeholder
					// row in the tree, keep the open untitled tab so the
					// user's buffer isn't lost, and surface an inline error
					// banner so they can correct the filename.
					const message =
						err instanceof Error ? err.message : String(err);
					try {
						model.move(event.destinationPath, pendingPlaceholder);
					} catch {
						// If the move fails (e.g. the destination row was
						// already removed by a refetch), restore from the
						// canonical paths and re-add the placeholder.
						restoreModelRef.current();
						model.add(pendingPlaceholder);
					}
					pendingNewFilePathRef.current = pendingPlaceholder;
					if (session) {
						registerNewFileSession(
							pendingPlaceholder,
							session.profileId,
							session.untitledPath,
						);
					}
					reportNewFileError(message);
				});
			return;
		}
		void renameFileTreePath
			.mutateAsync({
				sourcePath: event.sourcePath,
				destinationPath: event.destinationPath,
			})
			.catch(() => {
				restoreModelRef.current();
			});
	};
	moveFileTreePathsRef.current = (event) => {
		void moveFileTreePaths
			.mutateAsync({
				sourcePaths: [...event.draggedPaths],
				targetDirPath:
					event.target.kind === "root"
						? null
						: event.target.directoryPath,
			})
			.catch(() => {
				restoreModelRef.current();
			});
	};

	const { model } = useFileTree({
		dragAndDrop: {
			canDrag: (paths) =>
				paths.length > 0
				&& paths.every((path) => treePathSetRef.current.has(path)),
			canDrop: (event: FileTreeDropContext) => {
				const targetPath = event.target.directoryPath;
				return (
					event.draggedPaths.length > 0
					&& event.draggedPaths.every((path) =>
						treePathSetRef.current.has(path),
					)
					&& (event.target.kind === "root"
						|| targetPath == null
						|| treePathSetRef.current.has(targetPath))
				);
			},
			onDropComplete: (event) => {
				moveFileTreePathsRef.current(event);
			},
			onDropError: () => {
				restoreModelRef.current();
			},
		},
		density: "compact",
		flattenEmptyDirectories: true,
		gitStatus: [],
		icons: "complete",
		initialExpansion: "closed",
		onSelectionChange: (selectedPaths) => {
			setSelectedPaths([...selectedPaths]);
			if (skipNextSelectionOpenRef.current) {
				skipNextSelectionOpenRef.current = false;
				return;
			}
			if (selectedPaths.length !== 1) return;
			const selectedPath = selectedPaths[0];
			if (selectedPath && filePathSetRef.current.has(selectedPath)) {
				openRelativeFile(selectedPath);
			}
		},
		paths: [],
		renaming: {
			canRename: (item) =>
				item.path === pendingNewFilePathRef.current
				|| hasTreePath(treePathSetRef.current, item.path),
			onError: (error: string) => {
				if (pendingNewFilePathRef.current) {
					// Inline-create flow: keep the placeholder, reopen the
					// rename input, and surface the error in a banner so the
					// user can correct the name.
					reportNewFileError(error);
					return;
				}
				restoreModelRef.current();
			},
			onRename: (event) => {
				renameFileTreePathRef.current(event);
			},
		},
		stickyFolders: true,
	});
	modelRef.current = model;

	useEffect(() => {
		// While a placeholder is pending (inline rename for a new file), skip
		// the resetPaths call so the rename input is not torn down by background
		// git-status refetches. The placeholder will be reconciled with the
		// real path once the create mutation succeeds.
		if (pendingNewFilePathRef.current) return;
		model.resetPaths(modelPaths);
	}, [model, modelPaths]);

	useEffect(() => {
		return model.onMutation("remove", (event) => {
			if (event.path === pendingNewFilePathRef.current) {
				const placeholderPath = pendingNewFilePathRef.current;
				pendingNewFilePathRef.current = null;
				const session = consumeNewFileSession(placeholderPath);
				setNewFileError(null);
				model.resetPaths(modelPathsRef.current);

				// Clean up the editor tab tied to this aborted New File
				// session. If the user typed buffer content into the
				// untitled tab, leave it open as a blank canvas (per
				// VS Code behaviour); otherwise close it so an empty
				// scratch tab doesn't linger after the user gives up.
				if (session) {
					const buffer =
						useFileDraftStore.getState().drafts[session.untitledPath];
					const hasBuffer = buffer != null && buffer.length > 0;
					if (!hasBuffer) {
						closeFileTab(session.profileId, session.untitledPath);
						useFileDraftStore
							.getState()
							.clearForPath(session.untitledPath);
					}
				}
			}
		});
	}, [closeFileTab, consumeNewFileSession, model]);

	useEffect(() => {
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<NewFileCancelDetail>).detail;
			const placeholderPath = detail?.placeholderPath;
			if (!placeholderPath) return;
			if (pendingNewFilePathRef.current !== placeholderPath) return;

			// If the rename input is still active in the tree, simulate
			// pressing Escape on it so the library cleanly tears down its
			// internal renaming state machine. Falls back to a direct
			// `model.remove` (which the library does itself on Escape with
			// `removeIfCanceled: true`) if the DOM lookup fails.
			const host = model.getFileTreeContainer();
			const renameInput = host?.shadowRoot?.querySelector(
				"[data-item-rename-input]",
			) as HTMLElement | null;
			if (renameInput) {
				renameInput.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
						cancelable: true,
					}),
				);
				return;
			}
			try {
				model.remove(placeholderPath);
			} catch {
				// If the placeholder is already gone (e.g. another listener
				// removed it first) the mutation throws; the state was
				// already consistent so we can ignore.
			}
		};
		window.addEventListener(NEW_FILE_CANCEL_EVENT, handler);
		return () => {
			window.removeEventListener(NEW_FILE_CANCEL_EVENT, handler);
		};
	}, [model]);

	useEffect(() => {
		model.setGitStatus(gitStatus);
	}, [gitStatus, model]);

	const handleTreeClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (event.metaKey || event.ctrlKey || event.shiftKey) {
				skipNextSelectionOpenRef.current = false;
				return;
			}
			const itemPath = getTreeItemPath(event);
			if (itemPath && filePathSetRef.current.has(itemPath)) {
				openRelativeFile(itemPath);
			}
		},
		[openRelativeFile],
	);

	const handleTreeMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
		skipNextSelectionOpenRef.current =
			event.metaKey || event.ctrlKey || event.shiftKey;
	}, []);

	const handleStartRename = useCallback(
		(path: string) => {
			model.startRenaming(path);
		},
		[model],
	);

	const reportNewFileError = useCallback(
		(message: string) => {
			const placeholderPath = pendingNewFilePathRef.current;
			if (!placeholderPath) return;
			setNewFileError(message);
			// Re-open the rename input on the placeholder so the user can
			// retype. Defer one microtask so the library finishes resetting
			// its internal renaming state before we try to start it again.
			queueMicrotask(() => {
				if (pendingNewFilePathRef.current !== placeholderPath) return;
				skipNextSelectionOpenRef.current = true;
				const reopened = model.startRenaming(placeholderPath, {
					removeIfCanceled: true,
				});
				if (!reopened) {
					pendingNewFilePathRef.current = null;
					setNewFileError(null);
				}
			});
		},
		[model],
	);

	const handleSuppressNextSelectionOpen = useCallback(() => {
		skipNextSelectionOpenRef.current = true;
	}, []);

	const handleRequestNewFolder = useCallback((parentRelativePath: string) => {
		setNewFolderParentPath(parentRelativePath);
	}, []);

	const handleRequestNewFile = useCallback(
		(parentRelativePath: string) => {
			const existing = new Set(modelPathsRef.current);
			if (pendingNewFilePathRef.current) {
				existing.delete(pendingNewFilePathRef.current);
			}
			const placeholderPath = pickUniquePlaceholderPath(
				parentRelativePath,
				existing,
			);
			pendingNewFilePathRef.current = placeholderPath;
			skipNextSelectionOpenRef.current = true;
			setNewFileError(null);

			// Open a blank untitled tab so the editor surface is visible
			// while the user types the filename in the tree.
			const untitledPath = mintUntitledFilePath();
			const placeholderName =
				placeholderPath.split("/").pop() ?? "untitled";
			openUntitledTab(profileId, untitledPath, placeholderName);
			registerNewFileSession(placeholderPath, profileId, untitledPath);

			model.add(placeholderPath);
			const started = model.startRenaming(placeholderPath, {
				removeIfCanceled: true,
			});
			if (!started) {
				pendingNewFilePathRef.current = null;
				model.remove(placeholderPath);
			}
		},
		[model, openUntitledTab, profileId, registerNewFileSession],
	);

	const handleRequestDelete = useCallback(
		(path: string, isFolder: boolean) => {
			setDeleteTarget({ path, isFolder });
		},
		[],
	);

	const handleSubmitNewFolder = useCallback(
		async (relativePath: string) => {
			await createFileTreeFolder.mutateAsync({ targetPath: relativePath });
		},
		[createFileTreeFolder],
	);

	const handleConfirmDelete = useCallback(async () => {
		if (!deleteTarget) return;
		await deleteFileTreePath.mutateAsync({
			targetPath: deleteTarget.path,
		});
	}, [deleteFileTreePath, deleteTarget]);

	const handleEmptyAreaContextMenu = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (getTreeItemPath(event)) return;
			event.preventDefault();
			setEmptyAreaMenu({ x: event.clientX, y: event.clientY });
		},
		[],
	);

	const closeEmptyAreaMenu = useCallback(() => {
		setEmptyAreaMenu(null);
	}, []);

	useEffect(() => {
		if (!emptyAreaMenu) return;
		const handlePointer = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof HTMLElement) {
				if (target.closest("[data-file-tree-empty-menu]")) return;
			}
			closeEmptyAreaMenu();
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeEmptyAreaMenu();
		};
		window.addEventListener("pointerdown", handlePointer, true);
		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("pointerdown", handlePointer, true);
			window.removeEventListener("keydown", handleKey);
		};
	}, [closeEmptyAreaMenu, emptyAreaMenu]);

	const handleEmptyMenuRevealInFinder = () => {
		void revealAbsolutePathInFinder(rootPath);
		closeEmptyAreaMenu();
	};
	const handleEmptyMenuNewFile = () => {
		closeEmptyAreaMenu();
		handleRequestNewFile("");
	};
	const handleEmptyMenuNewFolder = () => {
		closeEmptyAreaMenu();
		setNewFolderParentPath("");
	};

	return (
		<>
			<Box
				h="full"
				flexShrink="0"
				pointerEvents={isOpen ? "auto" : "none"}
				aria-hidden={!isOpen}
			>
				<Box asChild h="full">
					<motion.div
						initial={false}
						animate={{ width: isOpen ? panelWidth : 0 }}
						transition={
							prefersReducedMotion || resize.isDragging
								? { duration: 0 }
								: FILE_TREE_PANEL_TRANSITION
						}
						style={{
							display: "flex",
							flexDirection: "column",
							minWidth: 0,
							overflow: "visible",
							position: "relative",
							willChange: "width",
						}}
					>
						<Box display="flex" flex="1" minH="0" overflow="hidden">
							<Box asChild flex="1" minH="0">
								<motion.div
									initial={false}
									animate={{
										opacity: isOpen ? 1 : 0,
										x: isOpen ? 0 : -12,
									}}
									transition={
										prefersReducedMotion
											? { duration: 0 }
											: FILE_TREE_CONTENT_TRANSITION
									}
									style={{
										display: "flex",
										flex: 1,
										minHeight: 0,
										minWidth: 0,
									}}
								>
									<Box
										flex="1"
										minH="0"
										minW="0"
										position="relative"
										py="1"
										display="flex"
										flexDirection="column"
										onContextMenu={handleEmptyAreaContextMenu}
									>
										{newFileError && (
											<Box
												role="alert"
												mx="2"
												mb="1"
												px="2"
												py="1"
												borderWidth="1px"
												borderColor="red.solid"
												bg="red.subtle"
												color="red.fg"
												borderRadius="md"
												fontSize="xs"
												lineHeight="1.4"
											>
												{newFileError}
											</Box>
										)}
										<FileTree
											model={model}
											onClick={handleTreeClick}
											onMouseDown={handleTreeMouseDown}
											renderContextMenu={(item, context) => (
												<FileTreeContextMenu
													context={context}
													filePathSet={filePathSet}
													item={item}
													renamablePathSet={treePathSet}
													rootPath={rootPath}
													selectedPaths={selectedPaths}
													onOpenFile={openRelativeFile}
													onStartRename={handleStartRename}
													onRequestNewFile={handleRequestNewFile}
													onRequestNewFolder={handleRequestNewFolder}
													onRequestDelete={handleRequestDelete}
													onSuppressNextSelectionOpen={
														handleSuppressNextSelectionOpen
													}
												/>
											)}
											style={FILE_TREE_HOST_STYLE}
										/>
										{isLoading && (
											<Center
												position="absolute"
												inset="0"
												pointerEvents="none"
											>
												<Spinner size="xs" />
											</Center>
										)}
									</Box>
								</motion.div>
							</Box>
						</Box>
						{isOpen && (
							<Box
								role="separator"
								aria-label={m.fileTreeResizeSeparator()}
								aria-orientation="vertical"
								aria-valuemin={FILE_TREE_PANEL_MIN_WIDTH}
								aria-valuemax={FILE_TREE_PANEL_MAX_WIDTH}
								aria-valuenow={panelWidth}
								tabIndex={0}
								position="absolute"
								top="0"
								right="-4px"
								bottom="0"
								w="8px"
								cursor="col-resize"
								zIndex={1}
								onPointerDown={resize.handlePointerDown}
								onKeyDown={resize.handleKeyDown}
								_focusVisible={{ outline: "none" }}
							/>
						)}
					</motion.div>
				</Box>
			</Box>

			<FileViewerDialog
				filePath={openFilePath}
				onClose={() => setOpenFilePath(null)}
			/>
			<FileTreeNewFolderDialog
				isOpen={newFolderParentPath !== null}
				parentRelativePath={newFolderParentPath ?? ""}
				onClose={() => setNewFolderParentPath(null)}
				onSubmit={handleSubmitNewFolder}
			/>
			<FileTreeDeleteDialog
				isOpen={deleteTarget !== null}
				targetPath={deleteTarget?.path ?? null}
				isFolder={deleteTarget?.isFolder ?? false}
				onClose={() => setDeleteTarget(null)}
				onConfirm={handleConfirmDelete}
			/>
			{emptyAreaMenu && (
				<div
					data-file-tree-empty-menu="true"
					role="menu"
					style={{
						...FILE_TREE_CONTEXT_MENU_STYLE,
						position: "fixed",
						top: emptyAreaMenu.y,
						left: emptyAreaMenu.x,
						right: "auto",
						zIndex: 1000,
					}}
				>
					<FileTreeContextMenuButton onClick={handleEmptyMenuRevealInFinder}>
						{m.fileTreeContextMenuRevealInFinder()}
					</FileTreeContextMenuButton>
					<FileTreeContextMenuButton onClick={handleEmptyMenuNewFile}>
						{m.fileTreeContextMenuNewFile()}
					</FileTreeContextMenuButton>
					<FileTreeContextMenuButton onClick={handleEmptyMenuNewFolder}>
						{m.fileTreeContextMenuNewFolder()}
					</FileTreeContextMenuButton>
				</div>
			)}
		</>
	);
}
