import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type {
  ContextMenuItem as FileTreeContextMenuItem,
  ContextMenuOpenContext as FileTreeContextMenuOpenContext,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTree as FileTreeModel,
  FileTreeRenameEvent,
  GitStatusEntry } from
"@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState } from
"react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator } from
"@/components/ui/dropdown-menu";
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
  writeFileTreeTerminalDropPayload } from
"@/shared/lib/fileTreeTerminalDrop";import { toast } from "sonner";

import { toFileTreeGitStatus } from "./fileTreeGitStatus";
import { compareFileTreePaths } from "./fileTreeSort";
import {
  useCreateFileTreePath,
  useDeleteFileTreePaths,
  useFileTreeExpandedChildPaths,
  useFileTreeChildPaths,
  useFileTreeGitStatus,
  useMoveFileTreePaths,
  useOpenPathInDefaultApp,
  useRefreshProfileWorkspaceCaches,
  useRenameFileTreePath,
  useRevealPathInFileManager } from
"./hooks";

const FILE_TREE_PANEL_TRANSITION = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.9
} as const;
const FILE_TREE_CONTENT_TRANSITION = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1]
} as const;
const FILE_TREE_PANEL_MIN_WIDTH = 180;
const FILE_TREE_PANEL_MAX_WIDTH = 560;
const DEFAULT_FILE_TREE_PANEL_WIDTH = 208;
const FILE_TREE_PANEL_STORAGE_KEY = "file-tree-panel";
const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;
const FILE_TREE_CREATE_NAMES = {
  directory: "New Folder",
  file: "New File"
} as const;
const FILE_TREE_HOST_STYLE = {
  height: "100%",
  minWidth: 0,
  width: "100%",
  "--trees-bg-muted-override": "var(--muted)",
  "--trees-bg-override": "transparent",
  "--trees-border-radius-override": "4px",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "var(--muted-foreground)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "13px",
  "--trees-item-margin-x-override": "4px",
  "--trees-item-padding-x-override": "4px",
  "--trees-level-gap-override": "12px",
  "--trees-padding-inline-override": "4px",
  "--trees-selected-bg-override": "var(--muted)",
  "--trees-selected-fg-override": "var(--foreground)"
} as CSSProperties;

interface FileTreePanelProps {
  profileId: string;
  rootPath: string;
  isOpen: boolean;
  isActive?: boolean;
  onOpenFile: (filePath: string) => void;
}

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

function clampFileTreePanelWidth(width: number) {
  return Math.min(
    FILE_TREE_PANEL_MAX_WIDTH,
    Math.max(FILE_TREE_PANEL_MIN_WIDTH, width)
  );
}

function sanitizeFileTreePanelWidth(width: unknown) {
  return typeof width === "number" && Number.isFinite(width) ?
  clampFileTreePanelWidth(width) :
  DEFAULT_FILE_TREE_PANEL_WIDTH;
}

function readStoredFileTreePanelWidth() {
  if (typeof window === "undefined") return DEFAULT_FILE_TREE_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(FILE_TREE_PANEL_STORAGE_KEY);
    if (!raw) return DEFAULT_FILE_TREE_PANEL_WIDTH;
    const parsed = JSON.parse(raw) as {
      panelWidth?: unknown;
      state?: {panelWidth?: unknown;};
    };
    return sanitizeFileTreePanelWidth(
      parsed.state?.panelWidth ?? parsed.panelWidth
    );
  } catch {
    return DEFAULT_FILE_TREE_PANEL_WIDTH;
  }
}

function writeStoredFileTreePanelWidth(width: number) {
  try {
    window.localStorage.setItem(
      FILE_TREE_PANEL_STORAGE_KEY,
      JSON.stringify({ state: { panelWidth: width }, version: 2 })
    );
  } catch {

    // Ignore restricted storage; resizing should still work in-memory.
  }}

function useFileTreePanelWidth() {
  const [panelWidth, setPanelWidth] = useState(
    readStoredFileTreePanelWidth
  );
  const updatePanelWidth = useCallback((width: number) => {
    setPanelWidth(clampFileTreePanelWidth(width));
  }, []);
  const persistPanelWidth = useCallback((width: number) => {
    writeStoredFileTreePanelWidth(clampFileTreePanelWidth(width));
  }, []);
  return [panelWidth, updatePanelWidth, persistPanelWidth] as const;
}

function toPathCollisionKey(path: string) {
  return path.replace(TRAILING_PATH_SEPARATOR_RE, "");
}

function toDirectoryPath(path: string) {
  return `${path.replace(TRAILING_PATH_SEPARATOR_RE, "")}/`;
}

function isSameOrDescendantPath(path: string, parentPath: string) {
  return (
    path === parentPath ||
    path.startsWith(toDirectoryPath(parentPath)));

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
treePathSet: ReadonlySet<string>)
{
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
draftPath: string | null)
{
  const paths: string[] = [];
  const seenPaths = new Set<string>();
  const seenPathCollisionKeys = new Set<string>();
  for (const path of [...(treePaths ?? []), ...(draftPath ? [draftPath] : [])]) {
    paths.push(path);
    seenPaths.add(path);
    seenPathCollisionKeys.add(toPathCollisionKey(path));
  }
  for (const entry of gitStatus) {
    const collisionKey = toPathCollisionKey(entry.path);
    if (
    seenPaths.has(entry.path) ||
    seenPathCollisionKeys.has(collisionKey))
    {
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
selectedPaths: readonly string[])
{
  return selectedPaths.includes(itemPath) ? selectedPaths : [itemPath];
}

function hasTreePath(pathSet: ReadonlySet<string>, path: string) {
  const directoryPath = `${path.replace(TRAILING_PATH_SEPARATOR_RE, "")}/`;
  return pathSet.has(path) || pathSet.has(directoryPath);
}

function buildExistingPathSet(
treePaths: readonly string[] | undefined,
gitStatus: readonly GitStatusEntry[])
{
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

type FileTreeCreateDraft = {
  kind: "directory" | "file";
  path: string;
} | null;

interface FileTreeUiState {
  draftCreate: FileTreeCreateDraft;
  expandedPaths: readonly string[];
  rootContextMenu: RootContextMenuState | null;
  selectedPaths: readonly string[];
}

type FileTreeUiAction =
{type: "closeRootContextMenu";} |
{type: "collapse";path: string;} |
{type: "expand";path: string;} |
{type: "openRootContextMenu";position: RootContextMenuState;} |
{type: "select";paths: readonly string[];} |
{type: "setDraftCreate";draftCreate: FileTreeCreateDraft;};

const FILE_TREE_UI_INITIAL_STATE: FileTreeUiState = {
  draftCreate: null,
  expandedPaths: [],
  rootContextMenu: null,
  selectedPaths: []
};

function fileTreeUiReducer(
state: FileTreeUiState,
action: FileTreeUiAction)
: FileTreeUiState {
  switch (action.type) {
    case "closeRootContextMenu":
      return state.rootContextMenu ?
      { ...state, rootContextMenu: null } :
      state;
    case "collapse":{
        const directoryPath = toDirectoryPath(action.path);
        const expandedPaths = state.expandedPaths.filter(
          (path) => !isSameOrDescendantPath(path, directoryPath)
        );
        return expandedPaths.length === state.expandedPaths.length ?
        state :
        { ...state, expandedPaths };
      }
    case "expand":{
        const directoryPath = toDirectoryPath(action.path);
        return state.expandedPaths.includes(directoryPath) ?
        state :
        {
          ...state,
          expandedPaths: [...state.expandedPaths, directoryPath]
        };
      }
    case "openRootContextMenu":
      return { ...state, rootContextMenu: action.position };
    case "select":
      return { ...state, selectedPaths: [...action.paths] };
    case "setDraftCreate":
      return { ...state, draftCreate: action.draftCreate };
  }
}

function getMenuPositioning(anchor: RootContextMenuState) {
  return () => ({
    getBoundingClientRect: () =>
      ({
        bottom: anchor.y,
        height: 0,
        left: anchor.x,
        right: anchor.x,
        top: anchor.y,
        width: 0,
        x: anchor.x,
        y: anchor.y
      }) as DOMRect
  });
}

function FileTreeMenu({
  children,
  onClose,
  position
}: {
  children: ReactNode;
  onClose: () => void;
  position: RootContextMenuState;
}) {
  return (
    <MenuPrimitive.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}>
      
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          anchor={getMenuPositioning(position)}
          positionMethod="fixed"
          side="bottom"
          sideOffset={2}
          align="start"
          collisionPadding={6}
          collisionAvoidance={{ side: "flip", align: "shift" }}
          className="isolate z-50 outline-none">
          
          <MenuPrimitive.Popup
            data-file-tree-context-menu-root="true"
            className="z-50 max-h-[var(--available-height)] min-w-40 overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>);

}

function resetFileTreeModel(
model: FileTreeModel | null,
paths: readonly string[],
expandedPaths: readonly string[])
{
  if (!model) return;
  if (expandedPaths.length > 0) {
    model.resetPaths(paths, { initialExpandedPaths: expandedPaths });
  } else {
    model.resetPaths(paths);
  }
}

interface FileTreeRootContextMenuProps {
  isRefreshing: boolean;
  position: RootContextMenuState;
  rootPath: string;
  onClose: () => void;
  onCreatePath: (
  parentPath: string | null,
  kind: "directory" | "file")
  => void;
  onRefresh: () => Promise<void>;
  onRevealRoot: () => void;
}

function FileTreeRootContextMenu({
  isRefreshing,
  position,
  rootPath,
  onClose,
  onCreatePath,
  onRefresh,
  onRevealRoot
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
  const handleRefresh = () => {
    if (isRefreshing) return;
    onClose();
    void onRefresh();
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
    <FileTreeMenu position={position} onClose={onClose}>
      <DropdownMenuItem onClick={handleCreateFile}>
        {m.fileTreeContextMenuNewFile()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleCreateDirectory}>
        {m.fileTreeContextMenuNewFolder()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={isRefreshing} onClick={handleRefresh}>
        {m.fileTreeContextMenuRefresh()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleRevealRoot}>
        {m.fileTreeContextMenuRevealInFileManager()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleCopyRelativePath}>
        {m.fileTreeContextMenuCopyRelativePath()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleCopyAbsolutePath}>
        {m.fileTreeContextMenuCopyAbsolutePath()}
      </DropdownMenuItem>
    </FileTreeMenu>);

}

interface FileTreeContextMenuProps {
  context: FileTreeContextMenuOpenContext;
  deletablePathSet: ReadonlySet<string>;
  filePathSet: ReadonlySet<string>;
  isDeleting: boolean;
  isRefreshing: boolean;
  item: FileTreeContextMenuItem;
  rootPath: string;
  selectedPaths: readonly string[];
  treePathSet: ReadonlySet<string>;
  onDeletePaths: (paths: readonly string[]) => void;
  onCreatePath: (
  parentPath: string | null,
  kind: "directory" | "file")
  => void;
  onOpenFile: (relativePath: string) => void;
  onOpenPathInDefaultApp: (relativePath: string) => void;
  onRefresh: () => Promise<void>;
  onRevealPath: (relativePath: string) => void;
  onStartRename: (path: string) => void;
}

function FileTreeContextMenu({
  context,
  deletablePathSet,
  filePathSet,
  isDeleting,
  isRefreshing,
  item,
  rootPath,
  selectedPaths,
  treePathSet,
  onDeletePaths,
  onCreatePath,
  onOpenFile,
  onOpenPathInDefaultApp,
  onRefresh,
  onRevealPath,
  onStartRename
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
      onOpenPathInDefaultApp(item.path)
      );
    }
  };
  const handleRefresh = () => {
    if (isRefreshing) return;
    context.close({ restoreFocus: false });
    void onRefresh();
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
      actionPaths.
      map((path) => toAbsolutePath(rootPath, path)).
      join("\n")
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
    <FileTreeMenu
      position={{
        x: context.anchorRect.x,
        y: context.anchorRect.y
      }}
      onClose={() => context.close()}>
      
      <DropdownMenuItem disabled={!canOpen} onClick={handleOpen}>
        {m.fileTreeContextMenuOpen()}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canOpenInDefaultApp}
        onClick={handleOpenInDefaultApp}>
        
        {m.fileTreeContextMenuOpenInDefaultApp()}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canReveal} onClick={handleRevealPath}>
        {m.fileTreeContextMenuRevealInFileManager()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={isRefreshing} onClick={handleRefresh}>
        {m.fileTreeContextMenuRefresh()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleCreateFile}>
        {m.fileTreeContextMenuNewFile()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleCreateDirectory}>
        {m.fileTreeContextMenuNewFolder()}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canRename} onClick={handleRename}>
        {m.rename()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleCopyRelativePath}>
        {m.fileTreeContextMenuCopyRelativePath()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleCopyAbsolutePath}>
        {m.fileTreeContextMenuCopyAbsolutePath()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        disabled={!canDelete || isDeleting}
        onClick={handleDelete}>
        
        {m.delete()}
      </DropdownMenuItem>
    </FileTreeMenu>);

}

function openAndCloseContextMenu(
context: FileTreeContextMenuOpenContext,
callback: () => void)
{
  callback();
  context.close();
}

export default function FileTreePanel({
  profileId,
  rootPath,
  isOpen,
  isActive = true,
  onOpenFile
}: FileTreePanelProps) {
  const [
  { draftCreate, expandedPaths, rootContextMenu, selectedPaths },
  dispatchFileTreeUi] =
  useReducer(fileTreeUiReducer, FILE_TREE_UI_INITIAL_STATE);
  const rootPathRef = useRef(rootPath);
  const onOpenFileRef = useRef(onOpenFile);
  const filePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const treePathSetRef = useRef<ReadonlySet<string>>(new Set());
  const modelPathsRef = useRef<readonly string[]>([]);
  const gitStatusRef = useRef<readonly GitStatusEntry[]>([]);
  const modelRef = useRef<FileTreeModel | null>(null);
  const draftCreateRef = useRef(draftCreate);
  const lastResetModelRef = useRef<FileTreeModel | null>(null);
  const lastResetDraftPathRef = useRef<string | null>(null);
  const renamingDraftPathRef = useRef<string | null>(null);
  const lastResetModelPathsRef = useRef<readonly string[] | null>(null);
  const lastResetExpandedPathsRef = useRef<readonly string[] | null>(null);
  const skipNextSelectionOpenRef = useRef(false);
  const skipNextClickOpenRef = useRef(false);
  const skipNextClickOpenUntilRef = useRef(0);
  const dragPayloadRef = useRef<FileTreeTerminalDropPayload | null>(null);
  const restoreModelRef = useRef(() => {});
  const renameFileTreePathRef = useRef((_event: FileTreeRenameEvent) => {});
  const moveFileTreePathsRef = useRef((_event: FileTreeDropResult) => {});
  const prefersReducedMotion = useReducedMotion() ?? false;
  const [panelWidth, setPanelWidth, persistPanelWidth] = useFileTreePanelWidth();
  const resize = useHorizontalResize({
    value: panelWidth,
    min: FILE_TREE_PANEL_MIN_WIDTH,
    max: FILE_TREE_PANEL_MAX_WIDTH,
    disabled: !isOpen,
    onChange: setPanelWidth,
    onCommit: persistPanelWidth
  });

  const {
    data: rootChildPaths,
    error: treePathsError,
    isError: isTreePathsError
  } = useFileTreeChildPaths(profileId, null, isOpen && isActive);
  const { data: gitStatusEntries } = useFileTreeGitStatus(
    profileId,
    isOpen && isActive
  );
  const expandedChildPaths = useFileTreeExpandedChildPaths(
    profileId,
    expandedPaths,
    isOpen && isActive
  );
  const createFileTreePath = useCreateFileTreePath(profileId);
  const renameFileTreePath = useRenameFileTreePath(profileId);
  const moveFileTreePaths = useMoveFileTreePaths(profileId);
  const deleteFileTreePaths = useDeleteFileTreePaths(profileId);
  const refreshProfileWorkspaceCaches =
  useRefreshProfileWorkspaceCaches(profileId);
  const openPathInDefaultApp = useOpenPathInDefaultApp(profileId);
  const revealPathInFileManager = useRevealPathInFileManager(profileId);
  const treePaths = useMemo(
    () => {
      const paths = rootChildPaths ? [...rootChildPaths] : [];
      for (const path of expandedChildPaths) {
        paths.push(path);
      }
      return paths;
    },
    [expandedChildPaths, rootChildPaths]
  );
  const gitStatus = useMemo(
    () => toFileTreeGitStatus(gitStatusEntries),
    [gitStatusEntries]
  );
  const modelPaths = useMemo(
    () => buildModelPaths(treePaths, gitStatus, draftCreate?.path ?? null),
    [draftCreate?.path, gitStatus, treePaths]
  );
  const existingPathSet = useMemo(
    () => buildExistingPathSet(treePaths, gitStatus),
    [gitStatus, treePaths]
  );
  const filePathSet = useMemo(
    () => {
      const next = new Set<string>();
      for (const path of existingPathSet) {
        if (!path.endsWith("/")) {
          next.add(path);
        }
      }
      return next;
    },
    [existingPathSet]
  );
  const treePathSet = existingPathSet;
  const deletablePathSet = existingPathSet;

  rootPathRef.current = rootPath;
  onOpenFileRef.current = onOpenFile;
  filePathSetRef.current = filePathSet;
  treePathSetRef.current = treePathSet;
  modelPathsRef.current = modelPaths;
  gitStatusRef.current = gitStatus;
  draftCreateRef.current = draftCreate;

  const openRelativeFile = useCallback((relativePath: string) => {
    onOpenFileRef.current(relativePath);
  }, []);

  const expandDirectoryPath = useCallback((path: string) => {
    dispatchFileTreeUi({ type: "expand", path });
  }, []);
  const collapseDirectoryPath = useCallback((path: string) => {
    dispatchFileTreeUi({ type: "collapse", path });
  }, []);
  restoreModelRef.current = () => {
    resetFileTreeModel(modelRef.current, modelPathsRef.current, expandedPaths);
    modelRef.current?.setGitStatus(gitStatusRef.current);
  };
  renameFileTreePathRef.current = (event) => {
    const draft = draftCreateRef.current;
    // Trees strips the trailing slash from folder paths before emitting the
    // rename event, so compare by collision key rather than raw path.
    if (
    draft &&
    toPathCollisionKey(draft.path) === toPathCollisionKey(event.sourcePath))
    {
      void createFileTreePath.
      mutateAsync({
        kind: draft.kind,
        path: event.destinationPath
      }).
      then(() => {
        dispatchFileTreeUi({
          type: "setDraftCreate",
          draftCreate: null
        });
      }).
      catch((error) => {
        toast.error(
          m.fileTreeCreateErrorTitle(), {
            description: getErrorMessage(error) });



        dispatchFileTreeUi({
          type: "setDraftCreate",
          draftCreate: null
        });
        restoreModelRef.current();
      });
      return;
    }
    void renameFileTreePath.
    mutateAsync({
      sourcePath: event.sourcePath,
      destinationPath: event.destinationPath
    }).
    catch(() => {
      restoreModelRef.current();
    });
  };
  moveFileTreePathsRef.current = (event) => {
    void moveFileTreePaths.
    mutateAsync({
      sourcePaths: [...event.draggedPaths],
      targetDirPath:
      event.target.kind === "root" ?
      null :
      event.target.directoryPath
    }).
    catch(() => {
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
          treePathSetRef.current.has(path)
          ) && (
          event.target.kind === "root" ||
          targetPath == null ||
          treePathSetRef.current.has(targetPath)));

      },
      onDropComplete: (event) => {
        moveFileTreePathsRef.current(event);
      },
      onDropError: () => {
        restoreModelRef.current();
      }
    },
    density: "compact",
    flattenEmptyDirectories: false,
    gitStatus: [],
    icons: "complete",
    initialExpansion: "closed",
    onSelectionChange: (selectedPaths) => {
      dispatchFileTreeUi({ type: "select", paths: selectedPaths });
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
      canRename: (item) => {
        const draftPath = draftCreateRef.current?.path;
        if (
        draftPath != null &&
        toPathCollisionKey(draftPath) === toPathCollisionKey(item.path))
        {
          return true;
        }
        return hasTreePath(treePathSetRef.current, item.path);
      },
      onError: () => {
        restoreModelRef.current();
      },
      onRename: (event) => {
        renameFileTreePathRef.current(event);
      }
    },
    stickyFolders: true
  });
  modelRef.current = model;

  useEffect(() => {
    // Resetting the model destroys any in-progress rename, so once the draft
    // item has been folded into the tree we freeze resets until it settles.
    if (draftCreate && lastResetDraftPathRef.current === draftCreate.path) {
      return;
    }
    if (
    !draftCreate &&
    lastResetDraftPathRef.current === null &&
    lastResetModelRef.current === model &&
    lastResetModelPathsRef.current === modelPaths &&
    lastResetExpandedPathsRef.current === expandedPaths)
    {
      return;
    }

    resetFileTreeModel(model, modelPaths, expandedPaths);
    lastResetDraftPathRef.current = draftCreate?.path ?? null;
    lastResetModelRef.current = model;
    lastResetModelPathsRef.current = modelPaths;
    lastResetExpandedPathsRef.current = expandedPaths;
  }, [draftCreate, expandedPaths, model, modelPaths]);

  // Runs after the reset effect above, so the draft item exists in the model.
  // Guarded by path so a re-render never restarts an in-progress edit.
  useEffect(() => {
    if (!draftCreate) {
      renamingDraftPathRef.current = null;
      return;
    }
    if (renamingDraftPathRef.current === draftCreate.path) return;
    renamingDraftPathRef.current = draftCreate.path;
    model.startRenaming(draftCreate.path, { removeIfCanceled: true });
  }, [draftCreate, model]);

  // Canceling the rename removes the draft row; drop the draft so the tree
  // resumes syncing with the query data.
  useEffect(() => {
    if (!draftCreate) return;
    const draftKey = toPathCollisionKey(draftCreate.path);
    return model.onMutation("remove", (event) => {
      if (toPathCollisionKey(event.path) !== draftKey) return;
      dispatchFileTreeUi({ type: "setDraftCreate", draftCreate: null });
    });
  }, [draftCreate, model]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  const handleTreeClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      dispatchFileTreeUi({ type: "closeRootContextMenu" });
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
          expandDirectoryPath(item.getPath());
        } else {
          collapseDirectoryPath(item.getPath());
        }
      }
    },
    [collapseDirectoryPath, expandDirectoryPath, model, openRelativeFile]
  );

  const handleTreeKeyUp = useCallback(
    (_event: KeyboardEvent<HTMLElement>) => {
      const item = model.getFocusedItem();
      if (!item?.isDirectory() || !("isExpanded" in item)) return;
      if (item.isExpanded()) {
        expandDirectoryPath(item.getPath());
      } else {
        collapseDirectoryPath(item.getPath());
      }
    },
    [collapseDirectoryPath, expandDirectoryPath, model]
  );

  const handleTreeMouseDown = useCallback(
    () => {
      skipNextSelectionOpenRef.current = true;
    },
    []
  );

  const handleStartRename = useCallback(
    (path: string) => {
      model.startRenaming(path);
    },
    [model]
  );
  const handleCreatePath = useCallback(
    (parentPath: string | null, kind: "directory" | "file") => {
      const createPath = uniqueCreatePath(
        parentPath,
        kind,
        treePathSetRef.current
      );
      if (parentPath) {
        expandDirectoryPath(parentPath);
      }
      dispatchFileTreeUi({
        type: "setDraftCreate",
        draftCreate: { kind, path: createPath }
      });
    },
    [expandDirectoryPath]
  );
  const handleTreeContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
      target instanceof HTMLElement &&
      target.closest("[data-file-tree-context-menu-root]"))
      {
        return;
      }
      if (getTreeItemPath(event)) {
        dispatchFileTreeUi({ type: "closeRootContextMenu" });
        return;
      }

      event.preventDefault();
      dispatchFileTreeUi({
        type: "openRootContextMenu",
        position: {
          x: event.clientX,
          y: event.clientY
        }
      });
    },
    []
  );
  const handleTreeDragStart = useCallback(
    (event: DragEvent<HTMLElement>) => {
      skipNextSelectionOpenRef.current = true;
      skipNextClickOpenRef.current = true;
      skipNextClickOpenUntilRef.current = Date.now() + 500;

      const itemPath = getTreeItemPathFromComposedPath(
        event.nativeEvent.composedPath()
      );
      if (!itemPath || !hasTreePath(treePathSetRef.current, itemPath)) {
        return;
      }

      const candidatePaths =
      selectedPaths.includes(itemPath) && selectedPaths.length > 0 ?
      selectedPaths :
      [itemPath];
      const relativePaths = candidatePaths.filter((path) =>
      hasTreePath(treePathSetRef.current, path)
      );
      if (relativePaths.length === 0) {
        return;
      }

      const rootPath = rootPathRef.current;
      const absolutePaths = relativePaths.map((path) =>
      toAbsolutePath(rootPath, path)
      );
      const payload = createFileTreeTerminalDropPayload({
        profileId,
        rootPath,
        relativePaths: [...relativePaths],
        absolutePaths
      });
      dragPayloadRef.current = payload;
      writeFileTreeTerminalDropPayload(event.dataTransfer, payload);
    },
    [profileId, selectedPaths]
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
        event.clientY
      );
      target?.dispatchEvent(
        new CustomEvent<FileTreeTerminalDropEventDetail>(
          FILE_TREE_TERMINAL_DROP_EVENT,
          {
            bubbles: true,
            detail: {
              clientX: event.clientX,
              clientY: event.clientY,
              payload
            }
          }
        )
      );
    }
  }, []);
  const closeRootContextMenu = useCallback(() => {
    dispatchFileTreeUi({ type: "closeRootContextMenu" });
  }, []);
  const handleRefresh = async () => {
    try {
      await refreshProfileWorkspaceCaches.mutateAsync();
    } catch (error) {
      toast.error(
        m.somethingWentWrong(), {
          description: getErrorMessage(error) });



    }
  };
  const handleDeletePaths = useCallback(
    async (paths: readonly string[]) => {
      try {
        await deleteFileTreePaths.mutateAsync({ paths: [...paths] });
      } catch (error) {
        toast.error(
          m.fileTreeDeleteErrorTitle(), {
            description:
            error instanceof Error ? error.message : String(error) });



      }
    },
    [deleteFileTreePaths]
  );
  const handleRevealPath = useCallback(
    async (relativePath: string) => {
      try {
        await revealPathInFileManager.mutateAsync({
          path: relativePath
        });
      } catch (error) {
        toast.error(
          m.somethingWentWrong(), {
            description: getErrorMessage(error) });



      }
    },
    [revealPathInFileManager]
  );
  const handleRevealRoot = useCallback(async () => {
    try {
      await revealPathInFileManager.mutateAsync({
        path: null
      });
    } catch (error) {
      toast.error(
        m.somethingWentWrong(), {
          description: getErrorMessage(error) });



    }
  }, [revealPathInFileManager]);
  const handleOpenPathInDefaultApp = useCallback(
    async (relativePath: string) => {
      try {
        await openPathInDefaultApp.mutateAsync({
          path: relativePath
        });
      } catch (error) {
        toast.error(
          m.somethingWentWrong(), {
            description: getErrorMessage(error) });



      }
    },
    [openPathInDefaultApp]
  );

  return (
    <>
			<div
        className="h-full shrink-0"
        style={{ pointerEvents: isOpen ? "auto" : "none" }}
        aria-hidden={!isOpen}>
        
				<motion.div
            initial={false}
            animate={{ width: isOpen ? panelWidth : 0 }}
            transition={
            prefersReducedMotion || resize.isDragging ?
            { duration: 0 } :
            FILE_TREE_PANEL_TRANSITION
            }
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minWidth: 0,
              overflow: "visible",
              position: "relative",
              willChange: "width"
            }}>
            
						<div className="flex min-h-0 flex-1 overflow-hidden">
							<motion.div
                  initial={false}
                  animate={{
                    opacity: isOpen ? 1 : 0,
                    x: isOpen ? 0 : -12
                  }}
                  transition={
                  prefersReducedMotion ?
                  { duration: 0 } :
                  FILE_TREE_CONTENT_TRANSITION
                  }
                  style={{
                    display: "flex",
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0
                  }}>
                  
									<div
                    className="relative min-h-0 min-w-0 flex-1 border-r px-1.5 py-1"
                    onContextMenu={handleTreeContextMenu}>
                    
										<FileTree
                      model={model}
                      onClick={handleTreeClick}
                      onDragEnd={handleTreeDragEnd}
                      onDragStart={handleTreeDragStart}
                      onKeyUp={handleTreeKeyUp}
                      onMouseDown={handleTreeMouseDown}
                      renderContextMenu={(
                      item,
                      context) =>

                      <FileTreeContextMenu
                        context={context}
                        deletablePathSet={
                        deletablePathSet
                        }
                        filePathSet={filePathSet}
                        isDeleting={
                        deleteFileTreePaths.isPending
                        }
                        isRefreshing={
                        refreshProfileWorkspaceCaches.isPending
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
                        onRefresh={handleRefresh}
                        onRevealPath={
                        handleRevealPath
                        }
                        onStartRename={
                        handleStartRename
                        } />

                      }
                      style={FILE_TREE_HOST_STYLE} />
                    
										{rootContextMenu &&
                    <FileTreeRootContextMenu
                      isRefreshing={
                      refreshProfileWorkspaceCaches.isPending
                      }
                      position={rootContextMenu}
                      rootPath={rootPath}
                      onClose={
                      closeRootContextMenu
                      }
                      onCreatePath={
                      handleCreatePath
                      }
                      onRefresh={handleRefresh}
                      onRevealRoot={
                      handleRevealRoot
                      } />

                    }
										{isTreePathsError &&
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      
												<p className="px-3 text-center text-xs text-muted-foreground">
													{getErrorMessage(
                          treePathsError
                        )}
												</p>
											</div>
                    }
									</div>
								</motion.div>
						</div>
						{isOpen &&
            <div
              role="separator"
              aria-label={m.fileTreeResizeSeparator()}
              aria-orientation="vertical"
              aria-valuemin={FILE_TREE_PANEL_MIN_WIDTH}
              aria-valuemax={FILE_TREE_PANEL_MAX_WIDTH}
              aria-valuenow={panelWidth}
              tabIndex={0}
              className="absolute top-0 -right-1 bottom-0 z-[1] w-2 cursor-col-resize focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]"
              onPointerDown={resize.handlePointerDown}
              onKeyDown={resize.handleKeyDown} />

            }
					</motion.div>
			</div>
		</>);

}
