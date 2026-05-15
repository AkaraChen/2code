import { Box, Center, Text } from "@chakra-ui/react";
import type {
	ContextMenuItem as FileTreeContextMenuItem,
	ContextMenuOpenContext as FileTreeContextMenuOpenContext,
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
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
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
import { toaster } from "@/shared/providers/appToaster";
import FileViewerDialog from "./FileViewerDialog";
import {
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	useFileTreeStore,
} from "./fileTreeStore";
import { buildFilePathSet } from "./fileTreePathSets";
import {
	useDeleteFileTreePaths,
	useFileTreeChildPaths,
	useFileTreeGitStatus,
	useLoadFileTreeChildPaths,
	useMoveFileTreePaths,
	useRenameFileTreePath,
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
const FILE_TREE_GIT_STATUSES = new Set<GitStatusEntry["status"]>([
	"added",
	"deleted",
	"ignored",
	"modified",
	"renamed",
	"untracked",
]);

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

const EMPTY_LOADED_CHILD_PATHS_BY_DIRECTORY = new Map<
	string,
	readonly string[]
>();

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

function isFileTreeGitStatus(
	status: string,
): status is GitStatusEntry["status"] {
	return FILE_TREE_GIT_STATUSES.has(status as GitStatusEntry["status"]);
}

function toPathCollisionKey(path: string) {
	return path.replace(TRAILING_PATH_SEPARATOR_RE, "");
}

function toFileTreeGitStatus(
	entries: readonly { path: string; status: string }[] | undefined,
): GitStatusEntry[] {
	if (!entries) return [];

	return entries.flatMap((entry) => {
		if (!entry.path || !isFileTreeGitStatus(entry.status)) return [];
		return [
			{
				path: entry.path,
				status: entry.status,
			},
		];
	});
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
	paths.sort((left, right) =>
		left.localeCompare(right, undefined, { sensitivity: "base" }),
	);
	return paths;
}

function getOnlyDirectoryChildPath(childPaths: readonly string[]) {
	return childPaths.length === 1 && childPaths[0]?.endsWith("/")
		? childPaths[0]
		: null;
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

interface FileTreeContextMenuButtonProps {
	children: ReactNode;
	danger?: boolean;
	disabled?: boolean;
	onClick: () => void;
}

function FileTreeContextMenuButton({
	children,
	danger = false,
	disabled = false,
	onClick,
}: FileTreeContextMenuButtonProps) {
	return (
		<button
			disabled={disabled}
			role="menuitem"
			style={{
				...FILE_TREE_CONTEXT_MENU_BUTTON_STYLE,
				color:
					danger && !disabled
						? "var(--chakra-colors-fg-error)"
						: "inherit",
				opacity: disabled ? 0.45 : 1,
			}}
			type="button"
			onClick={onClick}
			onMouseEnter={(event) => {
				if (!disabled) {
					event.currentTarget.style.background = danger
						? "var(--chakra-colors-bg-error)"
						: "var(--chakra-colors-bg-subtle)";
				}
			}}
			onMouseLeave={(event) => {
				event.currentTarget.style.background = "transparent";
			}}
		>
			{children}
		</button>
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
	onOpenFile: (relativePath: string) => void;
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
	onOpenFile,
	onStartRename,
}: FileTreeContextMenuProps) {
	const actionPaths = getContextMenuActionPaths(item.path, selectedPaths);
	const canOpen = item.kind === "file" && filePathSet.has(item.path);
	const canRename =
		actionPaths.length === 1 && hasTreePath(treePathSet, item.path);
	const canDelete =
		actionPaths.length > 0 &&
		actionPaths.every((path) => hasTreePath(deletablePathSet, path));

	const handleOpen = () => {
		if (canOpen)
			openAndCloseContextMenu(context, () => onOpenFile(item.path));
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

	return (
		<div
			data-file-tree-context-menu-root="true"
			role="menu"
			style={FILE_TREE_CONTEXT_MENU_STYLE}
		>
			<FileTreeContextMenuButton disabled={!canOpen} onClick={handleOpen}>
				{m.fileTreeContextMenuOpen()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				disabled={!canRename}
				onClick={handleRename}
			>
				{m.rename()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton onClick={handleCopyRelativePath}>
				{m.fileTreeContextMenuCopyRelativePath()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton onClick={handleCopyAbsolutePath}>
				{m.fileTreeContextMenuCopyAbsolutePath()}
			</FileTreeContextMenuButton>
			<FileTreeContextMenuButton
				danger
				disabled={!canDelete || isDeleting}
				onClick={handleDelete}
			>
				{m.delete()}
			</FileTreeContextMenuButton>
		</div>
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
	const renameFileTreePath = useRenameFileTreePath(rootPath, profileId);
	const moveFileTreePaths = useMoveFileTreePaths(rootPath, profileId);
	const deleteFileTreePaths = useDeleteFileTreePaths(rootPath, profileId);
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
		() => buildFilePathSet(existingPathSet),
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
	const loadExpandedDirectoryBranch = useCallback(
		(directoryPath: string) => {
			void loadDirectoryChildren(directoryPath).then(
				async (initialChildPaths) => {
					if (!expandedPathSetRef.current.has(directoryPath)) return;
					const visitedDirectoryPaths = new Set([directoryPath]);
					let nextDirectoryPath =
						getOnlyDirectoryChildPath(initialChildPaths);

					while (
						nextDirectoryPath &&
						!visitedDirectoryPaths.has(nextDirectoryPath)
					) {
						if (!expandedPathSetRef.current.has(directoryPath)) return;
						visitedDirectoryPaths.add(nextDirectoryPath);
						expandedPathSetRef.current.add(nextDirectoryPath);
						const childPaths =
							await loadDirectoryChildren(nextDirectoryPath);
						if (!expandedPathSetRef.current.has(directoryPath)) return;
						nextDirectoryPath =
							getOnlyDirectoryChildPath(childPaths);
					}
				},
			);
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
			canRename: (item) => hasTreePath(treePathSetRef.current, item.path),
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
			if (event.metaKey || event.ctrlKey || event.shiftKey) {
				skipNextSelectionOpenRef.current = false;
				return;
			}
			const itemPath = getTreeItemPath(event);
			if (itemPath && filePathSetRef.current.has(itemPath)) {
				openRelativeFile(itemPath);
				return;
			}

			const item = itemPath ? model.getItem(itemPath) : null;
			if (item?.isDirectory() && "isExpanded" in item) {
				if (item.isExpanded()) {
					expandedPathSetRef.current.add(item.getPath());
					loadExpandedDirectoryBranch(item.getPath());
				} else {
					expandedPathSetRef.current.delete(item.getPath());
				}
			}
		},
		[loadExpandedDirectoryBranch, model, openRelativeFile],
	);

	const handleTreeKeyUp = useCallback(
		(_event: KeyboardEvent<HTMLElement>) => {
			const item = model.getFocusedItem();
			if (!item?.isDirectory() || !("isExpanded" in item)) return;
			if (item.isExpanded()) {
				expandedPathSetRef.current.add(item.getPath());
				loadExpandedDirectoryBranch(item.getPath());
			} else {
				expandedPathSetRef.current.delete(item.getPath());
			}
		},
		[loadExpandedDirectoryBranch, model],
	);

	const handleTreeMouseDown = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			skipNextSelectionOpenRef.current =
				event.metaKey || event.ctrlKey || event.shiftKey;
		},
		[],
	);

	const handleStartRename = useCallback(
		(path: string) => {
			model.startRenaming(path);
		},
		[model],
	);
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
									>
										<FileTree
											model={model}
											onClick={handleTreeClick}
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
													onOpenFile={
														openRelativeFile
													}
													onStartRename={
														handleStartRename
													}
												/>
											)}
											style={FILE_TREE_HOST_STYLE}
										/>
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
		</>
	);
}
