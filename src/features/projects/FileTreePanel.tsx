import { FileTree, useFileTree } from "@pierre/trees/react";
import { Box, Center, Spinner } from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
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
import FileViewerDialog from "./FileViewerDialog";
import {
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	useFileTreeStore,
} from "./fileTreeStore";
import {
	useFileTreeGitStatus,
	useFileTreePaths,
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
	onClick: () => void;
}

function FileTreeContextMenuButton({
	children,
	disabled = false,
	onClick,
}: FileTreeContextMenuButtonProps) {
	return (
		<button
			disabled={disabled}
			role="menuitem"
			style={{
				...FILE_TREE_CONTEXT_MENU_BUTTON_STYLE,
				opacity: disabled ? 0.45 : 1,
			}}
			type="button"
			onClick={onClick}
			onMouseEnter={(event) => {
				if (!disabled) {
					event.currentTarget.style.background =
						"var(--chakra-colors-bg-subtle)";
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
	filePathSet: ReadonlySet<string>;
	item: FileTreeContextMenuItem;
	renamablePathSet: ReadonlySet<string>;
	rootPath: string;
	selectedPaths: readonly string[];
	onOpenFile: (relativePath: string) => void;
	onStartRename: (path: string) => void;
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
}: FileTreeContextMenuProps) {
	const actionPaths = getContextMenuActionPaths(item.path, selectedPaths);
	const canOpen = item.kind === "file" && filePathSet.has(item.path);
	const canRename =
		actionPaths.length === 1 && hasTreePath(renamablePathSet, item.path);

	const handleOpen = () => {
		if (canOpen) openAndCloseContextMenu(context, () => onOpenFile(item.path));
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
			actionPaths.map((path) => toAbsolutePath(rootPath, path)).join("\n"),
		).catch(() => {});
		context.close();
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
		model.resetPaths(modelPaths);
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
									<Box flex="1" minH="0" minW="0" position="relative" py="1" px="1.5">
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
		</>
	);
}
