import { Box, Center, Menu, Portal, Text } from "@chakra-ui/react";
import type {
	ContextMenuItem as FileTreeContextMenuItem,
	ContextMenuOpenContext as FileTreeContextMenuOpenContext,
	FileTreeDirectoryHandle,
	FileTreeDropContext,
	FileTreeDropResult,
	FileTree as FileTreeModel,
	FileTreeRenameEvent,
	GitStatusEntry,
} from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { motion, useReducedMotion } from "motion/react";
import {
	type CSSProperties,
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import * as m from "@/paraglide/messages.js";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { getErrorMessage } from "@/shared/lib/errors";
import {
	createFileTreeTerminalDropPayload,
	FILE_TREE_TERMINAL_DROP_EVENT,
	type FileTreeTerminalDropEventDetail,
	type FileTreeTerminalDropPayload,
	getFileTreeTerminalDropTargetAtPoint,
	writeFileTreeTerminalDropPayload,
} from "@/shared/lib/fileTreeTerminalDrop";
import { toaster } from "@/shared/providers/appToaster";
import FileViewerDialog from "./FileViewerDialog";
import { toFileTreeGitStatus } from "./fileTreeGitStatus";
import { compareFileTreePaths } from "./fileTreeSort";
import {
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	useFileTreeStore,
} from "./fileTreeStore";
import {
	useCreateFileTreePath,
	useDeleteFileTreePaths,
	useFileTreeChildPaths,
	useFileTreeGitStatus,
	useLoadFileTreeChildPaths,
	useMoveFileTreePaths,
	useOpenPathInDefaultApp,
	useRenameFileTreePath,
	useRevealPathInFileManager,
} from "./hooks";

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
const FILE_TREE_CREATE_NAMES = {
	directory: "New Folder",
	file: "New File",
} as const;
const FILE_TREE_HOST_STYLE = {
	height: "100%",
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

interface FileTreePanelProps {
	profileId: string;
	rootPath: string;
	isOpen: boolean;
	onOpenFile?: (filePath: string) => void;
}

const EMPTY_LOADED_CHILD_PATHS_BY_DIRECTORY = new Map<
	string,
	readonly string[]
>();

function getTreeItemPathFromComposedPath(composedPath: readonly EventTarget[]) {
	for (const target of composedPath) {
		if (target instanceof HTMLElement) {
			const itemPath = target.dataset.itemPath;
			if (itemPath) return itemPath;
		}
	}
	return null;
}

function getTreeItemPath(event: MouseEvent<HTMLElement>) {
	return getTreeItemPathFromComposedPath(event.nativeEvent.composedPath());
}

function toAbsolutePath(rootPath: string, relativePath: string) {
	const normalizedRoot = rootPath.replace(TRAILING_PATH_SEPARATOR_RE, "");
	return `${normalizedRoot}/${relativePath}`;
}

function toPathCollisionKey(path: string) {
	return path.replace(TRAILING_PATH_SEPARATOR_RE, "");
}

function getParentDirectoryPath(path: string) {
	const normalizedPath = path.replace(TRAILING_PATH_SEPARATOR_RE, "");
	const index = normalizedPath.lastIndexOf("/");
	if (index < 0) return null;
	return `${normalizedPath.slice(0, index)}/`;
}

function getCreateTargetDirectoryPath(item: FileTreeContextMenuItem | null) {
	if (!item) return null;
	if (item.kind === "directory") return item.path;
	return getParentDirectoryPath(item.path);
}

function joinFileTreePath(parentPath: string | null, name: string) {
	return parentPath ? `${parentPath}${name}` : name;
}

function uniqueCreatePath(
	parentPath: string | null,
	kind: "directory" | "file",
	treePathSet: ReadonlySet<string>,
) {
	const baseName = FILE_TREE_CREATE_NAMES[kind];
	const extension = kind === "directory" ? "/" : "";
	let index = 0;
	while (true) {
		const name = index === 0 ? baseName : `${baseName} ${index}`;
		const path = `${joinFileTreePath(parentPath, name)}${extension}`;
		if (!hasTreePath(treePathSet, path)) return path;
		index += 1;
	}
}

function buildModelPaths(
	treePaths: readonly string[] | undefined,
	gitStatus: readonly GitStatusEntry[],
) {
	const paths = [...(treePaths ?? [])];
	const seenPaths = new Set(paths);
	const seenPathCollisionKeys = new Set(paths.map(toPathCollisionKey));
	for (const entry of gitStatus) {
		const collisionKey = toPathCollisionKey(entry.path);
		if (
			seenPaths.has(entry.path) ||
			seenPathCollisionKeys.has(collisionKey)
		) {
			continue;
		}
		seenPaths.add(entry.path);
		seenPathCollisionKeys.add(collisionKey);
		paths.push(entry.path);
	}
	paths.sort(compareFileTreePaths);
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

function buildExistingPathSet(
	treePaths: readonly string[] | undefined,
	gitStatus: readonly GitStatusEntry[],
) {
	const paths = new Set(treePaths ?? []);
	for (const entry of gitStatus) {
		if (entry.status !== "deleted") {
			paths.add(entry.path);
		}
	}
	return paths;
}

interface RootContextMenuState {
	x: number;
	y: number;
}

function getMenuPositioning(anchor: RootContextMenuState) {
	return {
		fitViewport: true,
		flip: true,
		getAnchorRect: () => ({
			height: 0,
			width: 0,
			x: anchor.x,
			y: anchor.y,
		}),
		gutter: 2,
		overflowPadding: 6,
		placement: "bottom-start" as const,
		slide: true,
		strategy: "fixed" as const,
	};
}

interface FileTreeRootContextMenuProps {
	position: RootContextMenuState;
	rootPath: string;
	onClose: () => void;
	onCreatePath: (
		parentPath: string | null,
		kind: "directory" | "file",
	) => void;
	onRevealRoot: () => void;
}

function FileTreeRootContextMenu({
	position,
	rootPath,
	onClose,
	onCreatePath,
	onRevealRoot,
}: FileTreeRootContextMenuProps) {
	const handleCreateFile = () => {
		onClose();
		onCreatePath(null, "file");
	};
	const handleCreateDirectory = () => {
		onClose();
		onCreatePath(null, "directory");
	};
	const handleRevealRoot = () => {
		onClose();
		onRevealRoot();
	};
	const handleCopyRelativePath = () => {
		void copyTextToClipboard(".").catch(() => {});
		onClose();
	};
	const handleCopyAbsolutePath = () => {
		void copyTextToClipboard(rootPath).catch(() => {});
		onClose();
	};

	return (
		<Menu.Root
			open
			size="sm"
			positioning={getMenuPositioning(position)}
			onOpenChange={(event) => {
				if (!event.open) onClose();
			}}
		>
			<Portal>
				<Menu.Positioner>
					<Menu.Content
						data-file-tree-context-menu-root="true"
						minW="40"
					>
						<Menu.Item value="new-file" onClick={handleCreateFile}>
							{m.fileTreeContextMenuNewFile()}
						</Menu.Item>
						<Menu.Item
							value="new-folder"
							onClick={handleCreateDirectory}
						>
							{m.fileTreeContextMenuNewFolder()}
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							value="reveal"
							onClick={handleRevealRoot}
						>
							{m.fileTreeContextMenuRevealInFileManager()}
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							value="copy-relative-path"
							onClick={handleCopyRelativePath}
						>
							{m.fileTreeContextMenuCopyRelativePath()}
						</Menu.Item>
						<Menu.Item
							value="copy-absolute-path"
							onClick={handleCopyAbsolutePath}
						>
							{m.fileTreeContextMenuCopyAbsolutePath()}
						</Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}

interface FileTreeContextMenuProps {
	context: FileTreeContextMenuOpenContext;
	deletablePathSet: ReadonlySet<string>;
	filePathSet: ReadonlySet<string>;
	isDeleting: boolean;
	item: FileTreeContextMenuItem;
	rootPath: string;
	selectedPaths: readonly string[];
	treePathSet: ReadonlySet<string>;
	onDeletePaths: (paths: readonly string[]) => void;
	onCreatePath: (
		parentPath: string | null,
		kind: "directory" | "file",
	) => void;
	onOpenFile: (relativePath: string) => void;
	onOpenPathInDefaultApp: (relativePath: string) => void;
	onRevealPath: (relativePath: string) => void;
	onStartRename: (path: string) => void;
}

function FileTreeContextMenu({
	context,
	deletablePathSet,
	filePathSet,
	isDeleting,
	item,
	rootPath,
	selectedPaths,
	treePathSet,
	onDeletePaths,
	onCreatePath,
	onOpenFile,
	onOpenPathInDefaultApp,
	onRevealPath,
	onStartRename,
}: FileTreeContextMenuProps) {
	const actionPaths = getContextMenuActionPaths(item.path, selectedPaths);
	const canOpen = item.kind === "file" && filePathSet.has(item.path);
	const canOpenInDefaultApp = hasTreePath(deletablePathSet, item.path);
	const canReveal = canOpenInDefaultApp;
	const canRename =
		actionPaths.length === 1 && hasTreePath(treePathSet, item.path);
	const canDelete =
		actionPaths.length > 0 &&
		actionPaths.every((path) => hasTreePath(deletablePathSet, path));
	const createTargetDirectoryPath = getCreateTargetDirectoryPath(item);

	const handleOpen = () => {
		if (canOpen)
			openAndCloseContextMenu(context, () => onOpenFile(item.path));
	};
	const handleRevealPath = () => {
		if (canReveal)
			openAndCloseContextMenu(context, () => onRevealPath(item.path));
	};
	const handleOpenInDefaultApp = () => {
		if (canOpenInDefaultApp) {
			openAndCloseContextMenu(context, () =>
				onOpenPathInDefaultApp(item.path),
			);
		}
	};
	const handleRename = () => {
		if (!canRename) return;
		context.close({ restoreFocus: false });
		onStartRename(item.path);
	};
	const handleCopyRelativePath = () => {
		void copyTextToClipboard(actionPaths.join("\n")).catch(() => {});
		context.close();
	};
	const handleCopyAbsolutePath = () => {
		void copyTextToClipboard(
			actionPaths
				.map((path) => toAbsolutePath(rootPath, path))
				.join("\n"),
		).catch(() => {});
		context.close();
	};
	const handleDelete = () => {
		if (!canDelete || isDeleting) return;
		context.close({ restoreFocus: false });
		onDeletePaths(actionPaths);
	};
	const handleCreateFile = () => {
		context.close({ restoreFocus: false });
		onCreatePath(createTargetDirectoryPath, "file");
	};
	const handleCreateDirectory = () => {
		context.close({ restoreFocus: false });
		onCreatePath(createTargetDirectoryPath, "directory");
	};

	return (
		<Menu.Root
			open
			size="sm"
			positioning={getMenuPositioning({
				x: context.anchorRect.x,
				y: context.anchorRect.y,
			})}
			onOpenChange={(event) => {
				if (!event.open) context.close();
			}}
		>
			<Portal>
				<Menu.Positioner>
					<Menu.Content
						data-file-tree-context-menu-root="true"
						minW="40"
					>
						<Menu.Item
							value="open"
							disabled={!canOpen}
							onClick={handleOpen}
						>
							{m.fileTreeContextMenuOpen()}
						</Menu.Item>
						<Menu.Item
							value="open-default-app"
							disabled={!canOpenInDefaultApp}
							onClick={handleOpenInDefaultApp}
						>
							{m.fileTreeContextMenuOpenInDefaultApp()}
						</Menu.Item>
						<Menu.Item
							value="reveal"
							disabled={!canReveal}
							onClick={handleRevealPath}
						>
							{m.fileTreeContextMenuRevealInFileManager()}
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							value="new-file"
							onClick={handleCreateFile}
						>
							{m.fileTreeContextMenuNewFile()}
						</Menu.Item>
						<Menu.Item
							value="new-folder"
							onClick={handleCreateDirectory}
						>
							{m.fileTreeContextMenuNewFolder()}
						</Menu.Item>
						<Menu.Item
							value="rename"
							disabled={!canRename}
							onClick={handleRename}
						>
							{m.rename()}
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							value="copy-relative-path"
							onClick={handleCopyRelativePath}
						>
							{m.fileTreeContextMenuCopyRelativePath()}
						</Menu.Item>
						<Menu.Item
							value="copy-absolute-path"
							onClick={handleCopyAbsolutePath}
						>
							{m.fileTreeContextMenuCopyAbsolutePath()}
						</Menu.Item>
						<Menu.Separator />
						<Menu.Item
							value="delete"
							color="fg.error"
							disabled={!canDelete || isDeleting}
							_hover={{ bg: "bg.error", color: "fg.error" }}
							onClick={handleDelete}
						>
							{m.delete()}
						</Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
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
	const [rootContextMenu, setRootContextMenu] =
		useState<RootContextMenuState | null>(null);
	const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
	const [loadedChildPathsState, setLoadedChildPathsState] = useState<{
		rootPath: string;
		rootChildPaths: readonly string[] | undefined;
		childPathsByDirectory: ReadonlyMap<string, readonly string[]>;
	}>(() => ({
		rootPath,
		rootChildPaths: undefined,
		childPathsByDirectory: new Map(),
	}));
	const rootPathRef = useRef(rootPath);
	const rootChildPathsRef = useRef<readonly string[] | undefined>(undefined);
	const onOpenFileRef = useRef(onOpenFile);
	const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
	const treePathSetRef = useRef<ReadonlySet<string>>(new Set());
	const modelPathsRef = useRef<readonly string[]>([]);
	const gitStatusRef = useRef<readonly GitStatusEntry[]>([]);
	const modelRef = useRef<FileTreeModel | null>(null);
	const pendingCreatePathRef = useRef<
		Map<string, { kind: "directory" | "file" }>
	>(new Map());
	const lastResetModelRef = useRef<FileTreeModel | null>(null);
	const lastResetModelPathsSignatureRef = useRef<string | null>(null);
	const expandedPathSetRef = useRef<Set<string>>(new Set());
	const loadedDirectoryChildPathsRef = useRef<
		Map<string, readonly string[]>
	>(new Map());
	const loadingDirectoryPromisesRef = useRef<
		Map<string, Promise<readonly string[]>>
	>(new Map());
	const skipNextSelectionOpenRef = useRef(false);
	const skipNextClickOpenRef = useRef(false);
	const skipNextClickOpenUntilRef = useRef(0);
	const dragPayloadRef = useRef<FileTreeTerminalDropPayload | null>(null);
	const restoreModelRef = useRef(() => {});
	const renameFileTreePathRef = useRef((_event: FileTreeRenameEvent) => {});
	const moveFileTreePathsRef = useRef((_event: FileTreeDropResult) => {});
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

	const {
		data: rootChildPaths,
		error: treePathsError,
		isError: isTreePathsError,
	} = useFileTreeChildPaths(rootPath, null, isOpen);
	const { data: gitStatusEntries } = useFileTreeGitStatus(profileId, isOpen);
	const loadFileTreeChildPaths = useLoadFileTreeChildPaths(rootPath);
	const createFileTreePath = useCreateFileTreePath(rootPath, profileId);
	const renameFileTreePath = useRenameFileTreePath(rootPath, profileId);
	const moveFileTreePaths = useMoveFileTreePaths(rootPath, profileId);
	const deleteFileTreePaths = useDeleteFileTreePaths(rootPath, profileId);
	const openPathInDefaultApp = useOpenPathInDefaultApp();
	const revealPathInFileManager = useRevealPathInFileManager();
	const loadedDirectoryChildPaths =
		loadedChildPathsState.rootPath === rootPath &&
		loadedChildPathsState.rootChildPaths === rootChildPaths
			? loadedChildPathsState.childPathsByDirectory
			: EMPTY_LOADED_CHILD_PATHS_BY_DIRECTORY;
	const loadedChildPathsByDirectory = useMemo(() => {
		const next = new Map<string | null, readonly string[]>();
		for (const [directoryPath, childPaths] of loadedDirectoryChildPaths) {
			next.set(directoryPath, childPaths);
		}
		if (rootChildPaths) {
			next.set(null, rootChildPaths);
		}
		return next;
	}, [loadedDirectoryChildPaths, rootChildPaths]);
	const treePaths = useMemo(
		() => [...loadedChildPathsByDirectory.values()].flat(),
		[loadedChildPathsByDirectory],
	);
	const gitStatus = useMemo(
		() => toFileTreeGitStatus(gitStatusEntries),
		[gitStatusEntries],
	);
	const modelPaths = useMemo(
		() => buildModelPaths(treePaths, gitStatus),
		[gitStatus, treePaths],
	);
	const existingPathSet = useMemo(
		() => buildExistingPathSet(treePaths, gitStatus),
		[gitStatus, treePaths],
	);
	const filePathSet = useMemo(
		() =>
			new Set([...existingPathSet].filter((path) => !path.endsWith("/"))),
		[existingPathSet],
	);
	const treePathSet = existingPathSet;
	const deletablePathSet = existingPathSet;

	rootPathRef.current = rootPath;
	rootChildPathsRef.current = rootChildPaths;
	onOpenFileRef.current = onOpenFile;
	filePathSetRef.current = filePathSet;
	treePathSetRef.current = treePathSet;
	modelPathsRef.current = modelPaths;
	gitStatusRef.current = gitStatus;

	useEffect(() => {
		expandedPathSetRef.current.clear();
		loadedDirectoryChildPathsRef.current.clear();
		loadingDirectoryPromisesRef.current.clear();
		pendingCreatePathRef.current.clear();
		lastResetModelPathsSignatureRef.current = null;
	}, [rootPath]);

	useEffect(() => {
		if (!rootChildPaths) return;
		expandedPathSetRef.current.clear();
		loadedDirectoryChildPathsRef.current.clear();
		loadingDirectoryPromisesRef.current.clear();
		lastResetModelPathsSignatureRef.current = null;
	}, [rootPath, rootChildPaths]);

	const openRelativeFile = useCallback((relativePath: string) => {
		const filePath = toAbsolutePath(rootPathRef.current, relativePath);
		if (onOpenFileRef.current) {
			onOpenFileRef.current(filePath);
		} else {
			setOpenFilePath(filePath);
		}
	}, []);

	const loadDirectoryChildren = useCallback(
		(directoryPath: string) => {
			if (loadedDirectoryChildPathsRef.current.has(directoryPath)) {
				return Promise.resolve(
					loadedDirectoryChildPathsRef.current.get(directoryPath) ?? [],
				);
			}
			const pendingLoad =
				loadingDirectoryPromisesRef.current.get(directoryPath);
			if (pendingLoad) {
				return pendingLoad;
			}

			const requestRootPath = rootPathRef.current;
			const requestRootChildPaths = rootChildPathsRef.current;
			const loadPromise = loadFileTreeChildPaths(directoryPath)
				.then((childPaths) => {
					if (
						rootPathRef.current !== requestRootPath ||
						rootChildPathsRef.current !== requestRootChildPaths
					) {
						return [];
					}
					loadedDirectoryChildPathsRef.current.set(
						directoryPath,
						childPaths,
					);
					setLoadedChildPathsState((current) => {
						const next = new Map(
							current.rootPath === requestRootPath
								? current.childPathsByDirectory
								: undefined,
						);
						next.set(directoryPath, childPaths);
						return {
							rootPath: requestRootPath,
							rootChildPaths: requestRootChildPaths,
							childPathsByDirectory: next,
						};
					});
					return childPaths;
				})
				.catch((error) => {
					if (
						rootPathRef.current !== requestRootPath ||
						rootChildPathsRef.current !== requestRootChildPaths
					) {
						return [];
					}
					toaster.create({
						title: m.somethingWentWrong(),
						description: getErrorMessage(error),
						type: "error",
						closable: true,
					});
					return [];
				})
				.finally(() => {
					loadingDirectoryPromisesRef.current.delete(directoryPath);
				});
			loadingDirectoryPromisesRef.current.set(directoryPath, loadPromise);
			return loadPromise;
		},
		[loadFileTreeChildPaths],
	);
	const loadExpandedDirectoryChildren = useCallback(
		(directoryPath: string) => {
			void loadDirectoryChildren(directoryPath);
		},
		[loadDirectoryChildren],
	);

	restoreModelRef.current = () => {
		const expandedPaths = [...expandedPathSetRef.current];
		if (expandedPaths.length > 0) {
			modelRef.current?.resetPaths(modelPathsRef.current, {
				initialExpandedPaths: expandedPaths,
			});
		} else {
			modelRef.current?.resetPaths(modelPathsRef.current);
		}
		modelRef.current?.setGitStatus(gitStatusRef.current);
	};
	renameFileTreePathRef.current = (event) => {
		const pendingCreate = pendingCreatePathRef.current.get(
			event.sourcePath,
		);
		if (pendingCreate) {
			pendingCreatePathRef.current.delete(event.sourcePath);
			void createFileTreePath
				.mutateAsync({
					kind: pendingCreate.kind,
					path: event.destinationPath,
				})
				.catch((error) => {
					toaster.create({
						title: m.fileTreeCreateErrorTitle(),
						description: getErrorMessage(error),
						type: "error",
						closable: true,
					});
					restoreModelRef.current();
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
				paths.length > 0 &&
				paths.every((path) => treePathSetRef.current.has(path)),
			canDrop: (event: FileTreeDropContext) => {
				const targetPath = event.target.directoryPath;
				return (
					event.draggedPaths.length > 0 &&
					event.draggedPaths.every((path) =>
						treePathSetRef.current.has(path),
					) &&
					(event.target.kind === "root" ||
						targetPath == null ||
						treePathSetRef.current.has(targetPath))
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
		flattenEmptyDirectories: false,
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
				pendingCreatePathRef.current.has(item.path) ||
				hasTreePath(treePathSetRef.current, item.path),
			onError: () => {
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
		const modelPathsSignature = modelPaths.join("\0");
		if (
			lastResetModelRef.current === model &&
			lastResetModelPathsSignatureRef.current === modelPathsSignature
		) {
			return;
		}

		const expandedPaths = [...expandedPathSetRef.current];
		if (expandedPaths.length > 0) {
			model.resetPaths(modelPaths, {
				initialExpandedPaths: expandedPaths,
			});
		} else {
			model.resetPaths(modelPaths);
		}
		lastResetModelRef.current = model;
		lastResetModelPathsSignatureRef.current = modelPathsSignature;
	}, [model, modelPaths]);

	useEffect(() => {
		model.setGitStatus(gitStatus);
	}, [gitStatus, model]);

	const handleTreeClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			setRootContextMenu(null);
			if (skipNextClickOpenRef.current) {
				const shouldSkipClick = Date.now() <= skipNextClickOpenUntilRef.current;
				skipNextClickOpenRef.current = false;
				skipNextClickOpenUntilRef.current = 0;
				skipNextSelectionOpenRef.current = false;
				if (shouldSkipClick) return;
			}
			if (event.metaKey || event.ctrlKey || event.shiftKey) {
				skipNextSelectionOpenRef.current = false;
				return;
			}
			skipNextSelectionOpenRef.current = false;
			const itemPath = getTreeItemPath(event);
			if (itemPath && filePathSetRef.current.has(itemPath)) {
				openRelativeFile(itemPath);
				return;
			}

			const item = itemPath ? model.getItem(itemPath) : null;
			if (item?.isDirectory() && "isExpanded" in item) {
				if (item.isExpanded()) {
					expandedPathSetRef.current.add(item.getPath());
					loadExpandedDirectoryChildren(item.getPath());
				} else {
					expandedPathSetRef.current.delete(item.getPath());
				}
			}
		},
		[loadExpandedDirectoryChildren, model, openRelativeFile],
	);

	const handleTreeKeyUp = useCallback(
		(_event: KeyboardEvent<HTMLElement>) => {
			const item = model.getFocusedItem();
			if (!item?.isDirectory() || !("isExpanded" in item)) return;
			if (item.isExpanded()) {
				expandedPathSetRef.current.add(item.getPath());
				loadExpandedDirectoryChildren(item.getPath());
			} else {
				expandedPathSetRef.current.delete(item.getPath());
			}
		},
		[loadExpandedDirectoryChildren, model],
	);

	const handleTreeMouseDown = useCallback(
		() => {
			skipNextSelectionOpenRef.current = true;
		},
		[],
	);

	const handleStartRename = useCallback(
		(path: string) => {
			model.startRenaming(path);
		},
		[model],
	);
	const handleCreatePath = useCallback(
		(parentPath: string | null, kind: "directory" | "file") => {
			const createPath = uniqueCreatePath(
				parentPath,
				kind,
				treePathSetRef.current,
			);
			pendingCreatePathRef.current.set(createPath, { kind });
			model.add(createPath);
			if (parentPath) {
				expandedPathSetRef.current.add(parentPath);
				const parentItem = model.getItem(parentPath);
				if (parentItem?.isDirectory()) {
					(parentItem as FileTreeDirectoryHandle).expand();
				}
			}
			model.startRenaming(createPath, { removeIfCanceled: true });
		},
		[model],
	);
	const handleTreeContextMenu = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest("[data-file-tree-context-menu-root]")
			) {
				return;
			}
			if (getTreeItemPath(event)) {
				setRootContextMenu(null);
				return;
			}

			event.preventDefault();
			setRootContextMenu({
				x: event.clientX,
				y: event.clientY,
			});
		},
		[],
	);
	const handleTreeDragStart = useCallback(
		(event: DragEvent<HTMLElement>) => {
			skipNextSelectionOpenRef.current = true;
			skipNextClickOpenRef.current = true;
			skipNextClickOpenUntilRef.current = Date.now() + 500;

			const itemPath = getTreeItemPathFromComposedPath(
				event.nativeEvent.composedPath(),
			);
			if (!itemPath || !hasTreePath(treePathSetRef.current, itemPath)) {
				return;
			}

			const candidatePaths =
				selectedPaths.includes(itemPath) && selectedPaths.length > 0
					? selectedPaths
					: [itemPath];
			const relativePaths = candidatePaths.filter((path) =>
				hasTreePath(treePathSetRef.current, path),
			);
			if (relativePaths.length === 0) {
				return;
			}

			const rootPath = rootPathRef.current;
			const absolutePaths = relativePaths.map((path) =>
				toAbsolutePath(rootPath, path),
			);
			const payload = createFileTreeTerminalDropPayload({
				profileId,
				rootPath,
				relativePaths: [...relativePaths],
				absolutePaths,
			});
			dragPayloadRef.current = payload;
			writeFileTreeTerminalDropPayload(event.dataTransfer, payload);
		},
		[profileId, selectedPaths],
	);
	const handleTreeDragEnd = useCallback((event: DragEvent<HTMLElement>) => {
		if (skipNextClickOpenRef.current) {
			skipNextClickOpenUntilRef.current = Date.now() + 500;
		}
		const payload = dragPayloadRef.current;
		dragPayloadRef.current = null;
		if (payload) {
			const target = getFileTreeTerminalDropTargetAtPoint(
				event.clientX,
				event.clientY,
			);
			target?.dispatchEvent(
				new CustomEvent<FileTreeTerminalDropEventDetail>(
					FILE_TREE_TERMINAL_DROP_EVENT,
					{
						bubbles: true,
						detail: {
							clientX: event.clientX,
							clientY: event.clientY,
							payload,
						},
					},
				),
			);
		}
	}, []);
	const closeRootContextMenu = useCallback(() => {
		setRootContextMenu(null);
	}, []);
	const handleDeletePaths = useCallback(
		async (paths: readonly string[]) => {
			try {
				await deleteFileTreePaths.mutateAsync({ paths: [...paths] });
			} catch (error) {
				toaster.create({
					title: m.fileTreeDeleteErrorTitle(),
					description:
						error instanceof Error ? error.message : String(error),
					type: "error",
					closable: true,
				});
			}
		},
		[deleteFileTreePaths],
	);
	const handleRevealPath = useCallback(
		async (relativePath: string) => {
			try {
				await revealPathInFileManager.mutateAsync({
					path: toAbsolutePath(rootPathRef.current, relativePath),
				});
			} catch (error) {
				toaster.create({
					title: m.somethingWentWrong(),
					description: getErrorMessage(error),
					type: "error",
					closable: true,
				});
			}
		},
		[revealPathInFileManager],
	);
	const handleRevealRoot = useCallback(async () => {
		try {
			await revealPathInFileManager.mutateAsync({
				path: rootPathRef.current,
			});
		} catch (error) {
			toaster.create({
				title: m.somethingWentWrong(),
				description: getErrorMessage(error),
				type: "error",
				closable: true,
			});
		}
	}, [revealPathInFileManager]);
	const handleOpenPathInDefaultApp = useCallback(
		async (relativePath: string) => {
			try {
				await openPathInDefaultApp.mutateAsync({
					path: toAbsolutePath(rootPathRef.current, relativePath),
				});
			} catch (error) {
				toaster.create({
					title: m.somethingWentWrong(),
					description: getErrorMessage(error),
					type: "error",
					closable: true,
				});
			}
		},
		[openPathInDefaultApp],
	);

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
										px="1.5"
										onContextMenu={handleTreeContextMenu}
									>
										<FileTree
											model={model}
											onClick={handleTreeClick}
											onDragEnd={handleTreeDragEnd}
											onDragStart={handleTreeDragStart}
											onKeyUp={handleTreeKeyUp}
											onMouseDown={handleTreeMouseDown}
											renderContextMenu={(
												item,
												context,
											) => (
												<FileTreeContextMenu
													context={context}
													deletablePathSet={
														deletablePathSet
													}
													filePathSet={filePathSet}
													isDeleting={
														deleteFileTreePaths.isPending
													}
													item={item}
													rootPath={rootPath}
													selectedPaths={
														selectedPaths
													}
													treePathSet={treePathSet}
													onDeletePaths={
														handleDeletePaths
													}
													onCreatePath={
														handleCreatePath
													}
													onOpenFile={
														openRelativeFile
													}
													onOpenPathInDefaultApp={
														handleOpenPathInDefaultApp
													}
													onRevealPath={
														handleRevealPath
													}
													onStartRename={
														handleStartRename
													}
												/>
											)}
											style={FILE_TREE_HOST_STYLE}
										/>
										{rootContextMenu && (
											<FileTreeRootContextMenu
												position={rootContextMenu}
												rootPath={rootPath}
												onClose={
													closeRootContextMenu
												}
												onCreatePath={
													handleCreatePath
												}
												onRevealRoot={
													handleRevealRoot
												}
											/>
										)}
										{isTreePathsError && (
											<Center
												position="absolute"
												inset="0"
												pointerEvents="none"
											>
												<Text
													color="fg.muted"
													fontSize="xs"
													px="3"
													textAlign="center"
												>
													{getErrorMessage(
														treePathsError,
													)}
												</Text>
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
								_focusVisible={{
									outline: "2px solid",
									outlineColor: "var(--app-focus-ring)",
									outlineOffset: "-2px",
								}}
							/>
						)}
					</motion.div>
				</Box>
			</Box>

			<FileViewerDialog
				filePath={openFilePath}
				onClose={() => setOpenFilePath(null)}
			/>
		</>
	);
}
