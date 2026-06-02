import { ChakraProvider } from "@chakra-ui/react";
import type { FileTreeOptions } from "@pierre/trees";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import FileTreePanel from "./FileTreePanel";
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

const {
	addPathMock,
	closeContextMenuMock,
	contextMenuItemRef,
	copyTextToClipboardMock,
	createMutateAsyncMock,
	deleteMutateAsyncMock,
	expandedPathsRef,
	getFocusedItemMock,
	moveMutateAsyncMock,
	renameMutateAsyncMock,
	revealMutateAsyncMock,
	resetPathsMock,
	setGitStatusMock,
	startRenamingMock,
	loadChildPathsMock,
	toasterCreateMock,
	useFileTreeOptionsRef,
	openDefaultAppMutateAsyncMock,
} = vi.hoisted(() => ({
	addPathMock: vi.fn(),
	closeContextMenuMock: vi.fn(),
	contextMenuItemRef: {
		current: {
			kind: "file" as "directory" | "file",
			path: "src/index.ts",
		},
	},
	copyTextToClipboardMock: vi.fn(),
	createMutateAsyncMock: vi.fn(),
	deleteMutateAsyncMock: vi.fn(),
	expandedPathsRef: {
		current: new Set<string>(),
	},
	getFocusedItemMock: vi.fn(),
	moveMutateAsyncMock: vi.fn(),
	renameMutateAsyncMock: vi.fn(),
	revealMutateAsyncMock: vi.fn(),
	resetPathsMock: vi.fn(),
	setGitStatusMock: vi.fn(),
	startRenamingMock: vi.fn(),
	loadChildPathsMock: vi.fn(),
	toasterCreateMock: vi.fn(),
	useFileTreeOptionsRef: {
		current: null as null | FileTreeOptions,
	},
	openDefaultAppMutateAsyncMock: vi.fn(),
}));

vi.mock("@/shared/providers/appToaster", () => ({
	toaster: {
		create: toasterCreateMock,
	},
}));

vi.mock("@/shared/lib/clipboard", () => ({
	copyTextToClipboard: copyTextToClipboardMock,
}));

vi.mock("@pierre/trees/react", () => ({
	FileTree: ({
		onClick,
		onKeyUp,
		onMouseDown,
		renderContextMenu,
	}: {
		onClick?: MouseEventHandler<HTMLElement>;
		onKeyUp?: KeyboardEventHandler<HTMLElement>;
		onMouseDown?: MouseEventHandler<HTMLElement>;
		renderContextMenu?: (
			item: { kind: "directory" | "file"; path: string },
			context: {
				anchorRect: {
					bottom: number;
					height: number;
					left: number;
					right: number;
					top: number;
					width: number;
					x: number;
					y: number;
				};
				close: (options?: unknown) => void;
			},
		) => ReactNode;
	}) => (
		<div data-testid="pierre-tree" onKeyUp={onKeyUp}>
			<button
				data-item-path="src/"
				onClick={(event) => {
					if (expandedPathsRef.current.has("src/")) {
						expandedPathsRef.current.delete("src/");
					} else {
						expandedPathsRef.current.add("src/");
					}
					onClick?.(event);
				}}
				onMouseDown={
					onMouseDown as MouseEventHandler<HTMLButtonElement>
				}
				type="button"
			>
				src
			</button>
			<button
				data-item-path="src/index.ts"
				onClick={onClick as MouseEventHandler<HTMLButtonElement>}
				onMouseDown={
					onMouseDown as MouseEventHandler<HTMLButtonElement>
				}
				type="button"
			>
				index.ts
			</button>
			<button
				data-item-path="ignored.log"
				onClick={onClick as MouseEventHandler<HTMLButtonElement>}
				onMouseDown={
					onMouseDown as MouseEventHandler<HTMLButtonElement>
				}
				type="button"
			>
				ignored.log
			</button>
			{renderContextMenu?.(contextMenuItemRef.current, {
				anchorRect: {
					bottom: 10,
					height: 0,
					left: 10,
					right: 10,
					top: 10,
					width: 0,
					x: 10,
					y: 10,
				},
				close: closeContextMenuMock,
			})}
		</div>
	),
	useFileTree: vi.fn((options: FileTreeOptions) => {
		useFileTreeOptionsRef.current = options;
		return {
			model: {
				getFocusedItem: getFocusedItemMock,
				getItem: (path: string) => {
					if (path.endsWith("/")) {
						return {
							expand: vi.fn(),
							getPath: () => path,
							isDirectory: (): true => true,
							isExpanded: () =>
								expandedPathsRef.current.has(path),
						};
					}
					return {
						getPath: () => path,
						isDirectory: (): false => false,
					};
				},
				add: addPathMock,
				resetPaths: resetPathsMock,
				setGitStatus: setGitStatusMock,
				startRenaming: startRenamingMock,
			},
		};
	}),
}));

vi.mock("./hooks", () => ({
	useCreateFileTreePath: vi.fn(),
	useDeleteFileTreePaths: vi.fn(),
	useFileTreeChildPaths: vi.fn(),
	useFileTreeGitStatus: vi.fn(),
	useLoadFileTreeChildPaths: vi.fn(),
	useMoveFileTreePaths: vi.fn(),
	useOpenPathInDefaultApp: vi.fn(),
	useRenameFileTreePath: vi.fn(),
	useRevealPathInFileManager: vi.fn(),
}));

vi.mock("./FileViewerDialog", () => ({
	default: () => null,
}));

const rootPath = "/root";
const profileId = "profile-1";
const treePaths = ["src/", "src/index.ts"];

type FileTreeChildPathsResult = ReturnType<typeof useFileTreeChildPaths>;
type FileTreeGitStatusResult = ReturnType<typeof useFileTreeGitStatus>;

function createFileTreeChildPathsResult(
	data: string[] | undefined,
	isLoading: boolean,
	error: Error | null = null,
): FileTreeChildPathsResult {
	return {
		data,
		error,
		isError: error != null,
		isLoading,
	} as FileTreeChildPathsResult;
}

function createFileTreeGitStatusResult(
	data: { path: string; status: string }[] | undefined,
	isLoading = false,
): FileTreeGitStatusResult {
	return {
		data,
		isLoading,
	} as FileTreeGitStatusResult;
}

function renderPanel(onOpenFile = vi.fn()) {
	render(
		<ChakraProvider value={appSystem}>
			<FileTreePanel
				profileId={profileId}
				rootPath={rootPath}
				isOpen
				onOpenFile={onOpenFile}
			/>
		</ChakraProvider>,
	);
	return { onOpenFile };
}

function getLastMenuItem(name: string) {
	const items = screen.getAllByRole("menuitem", { name });
	const item = items[items.length - 1];
	if (!item) throw new Error(`missing menu item: ${name}`);
	return item;
}

describe("fileTreePanel", () => {
	beforeEach(() => {
		addPathMock.mockReset();
		closeContextMenuMock.mockReset();
		copyTextToClipboardMock.mockReset();
		copyTextToClipboardMock.mockResolvedValue(undefined);
		contextMenuItemRef.current = { kind: "file", path: "src/index.ts" };
		createMutateAsyncMock.mockReset();
		createMutateAsyncMock.mockResolvedValue(undefined);
		deleteMutateAsyncMock.mockReset();
		deleteMutateAsyncMock.mockResolvedValue(undefined);
		moveMutateAsyncMock.mockReset();
		moveMutateAsyncMock.mockResolvedValue(undefined);
		renameMutateAsyncMock.mockReset();
		renameMutateAsyncMock.mockResolvedValue(undefined);
		revealMutateAsyncMock.mockReset();
		revealMutateAsyncMock.mockResolvedValue(undefined);
		resetPathsMock.mockReset();
		setGitStatusMock.mockReset();
		startRenamingMock.mockReset();
		loadChildPathsMock.mockReset();
		loadChildPathsMock.mockResolvedValue([]);
		openDefaultAppMutateAsyncMock.mockReset();
		openDefaultAppMutateAsyncMock.mockResolvedValue(undefined);
		getFocusedItemMock.mockReset();
		expandedPathsRef.current.clear();
		toasterCreateMock.mockReset();
		useFileTreeOptionsRef.current = null;
		vi.mocked(useFileTreeChildPaths).mockReturnValue(
			createFileTreeChildPathsResult(treePaths, false),
		);
		vi.mocked(useLoadFileTreeChildPaths).mockReturnValue(
			loadChildPathsMock,
		);
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult([], false),
		);
		vi.mocked(useCreateFileTreePath).mockReturnValue({
			mutateAsync: createMutateAsyncMock,
		} as unknown as ReturnType<typeof useCreateFileTreePath>);
		vi.mocked(useRenameFileTreePath).mockReturnValue({
			mutateAsync: renameMutateAsyncMock,
		} as unknown as ReturnType<typeof useRenameFileTreePath>);
		vi.mocked(useMoveFileTreePaths).mockReturnValue({
			mutateAsync: moveMutateAsyncMock,
		} as unknown as ReturnType<typeof useMoveFileTreePaths>);
		vi.mocked(useDeleteFileTreePaths).mockReturnValue({
			isPending: false,
			mutateAsync: deleteMutateAsyncMock,
		} as unknown as ReturnType<typeof useDeleteFileTreePaths>);
		vi.mocked(useOpenPathInDefaultApp).mockReturnValue({
			mutateAsync: openDefaultAppMutateAsyncMock,
		} as unknown as ReturnType<typeof useOpenPathInDefaultApp>);
		vi.mocked(useRevealPathInFileManager).mockReturnValue({
			mutateAsync: revealMutateAsyncMock,
		} as unknown as ReturnType<typeof useRevealPathInFileManager>);
	});

	it("resets the Pierre tree model with loaded paths", async () => {
		renderPanel();

		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith(treePaths);
		});
	});

	it("loads direct children when a directory is expanded", async () => {
		vi.mocked(useFileTreeChildPaths).mockReturnValue(
			createFileTreeChildPathsResult(["src/"], false),
		);
		loadChildPathsMock.mockResolvedValue(["src/index.ts"]);

		renderPanel();
		fireEvent.click(screen.getByText("src"));

		await waitFor(() => {
			expect(loadChildPathsMock).toHaveBeenCalledWith("src/");
		});
		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith(
				["src/", "src/index.ts"],
				{ initialExpandedPaths: ["src/"] },
			);
		});
	});

	it("loads only direct children when a directory is expanded", async () => {
		vi.mocked(useFileTreeChildPaths).mockReturnValue(
			createFileTreeChildPathsResult(["src/"], false),
		);
		loadChildPathsMock.mockImplementation((path: string) => {
			if (path === "src/") {
				return Promise.resolve(["src/components/"]);
			}
			if (path === "src/components/") {
				return Promise.resolve(["src/components/Button.tsx"]);
			}
			return Promise.resolve([]);
		});

		renderPanel();
		fireEvent.click(screen.getByText("src"));

		await waitFor(() => {
			expect(loadChildPathsMock).toHaveBeenCalledWith("src/");
		});
		expect(loadChildPathsMock).not.toHaveBeenCalledWith(
			"src/components/",
		);
		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith(
				["src/", "src/components/"],
				{ initialExpandedPaths: ["src/"] },
			);
		});
	});

	it("shows the file tree load error in the loading overlay layout", () => {
		vi.mocked(useFileTreeChildPaths).mockReturnValue(
			createFileTreeChildPathsResult(
				undefined,
				false,
				new Error("tree failed"),
			),
		);

		renderPanel();

		expect(screen.getByText("tree failed")).toBeInTheDocument();
	});

	it("enables requested Pierre tree features", () => {
		renderPanel();

		expect(useFileTreeOptionsRef.current).toMatchObject({
			flattenEmptyDirectories: false,
			stickyFolders: true,
			density: "compact",
			icons: "complete",
		});
		expect(useFileTreeOptionsRef.current?.dragAndDrop).toEqual(
			expect.objectContaining({
				canDrag: expect.any(Function),
				canDrop: expect.any(Function),
				onDropComplete: expect.any(Function),
			}),
		);
		expect(useFileTreeOptionsRef.current?.renaming).toEqual(
			expect.objectContaining({
				canRename: expect.any(Function),
				onRename: expect.any(Function),
			}),
		);
	});

	it("passes git status to the Pierre model and keeps status-only paths visible", async () => {
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[
					{ path: "deleted.ts", status: "deleted" },
					{ path: "src/index.ts", status: "modified" },
				],
				false,
			),
		);

		renderPanel();

		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith([
				"deleted.ts",
				"src/",
				"src/index.ts",
			]);
		});
		expect(setGitStatusMock).toHaveBeenCalledWith([
			{ path: "deleted.ts", status: "deleted" },
			{ path: "src/index.ts", status: "modified" },
		]);
	});

	it("keeps backend-normalized git status for submodule directory paths", async () => {
		vi.mocked(useFileTreeChildPaths).mockReturnValue(
			createFileTreeChildPathsResult(
				[
					"claude-agent-sdk-python/",
					"claude-agent-sdk-python/README.md",
				],
				false,
			),
		);
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[{ path: "claude-agent-sdk-python/", status: "modified" }],
				false,
			),
		);

		renderPanel();

		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith([
				"claude-agent-sdk-python/",
				"claude-agent-sdk-python/README.md",
			]);
		});
		expect(setGitStatusMock).toHaveBeenCalledWith([
			{ path: "claude-agent-sdk-python/", status: "modified" },
		]);
	});

	it("opens file rows from tree click events", () => {
		const { onOpenFile } = renderPanel();

		fireEvent.click(screen.getByText("index.ts"));

		expect(onOpenFile).toHaveBeenCalledWith("/root/src/index.ts");
	});

	it("opens status-only ignored file rows from tree click events", () => {
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[{ path: "ignored.log", status: "ignored" }],
				false,
			),
		);
		const { onOpenFile } = renderPanel();

		fireEvent.click(screen.getByText("ignored.log"));

		expect(onOpenFile).toHaveBeenCalledWith("/root/ignored.log");
	});

	it("does not open status-only deleted file rows", () => {
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[{ path: "ignored.log", status: "deleted" }],
				false,
			),
		);
		const { onOpenFile } = renderPanel();

		fireEvent.click(screen.getByText("ignored.log"));

		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("opens selected files for keyboard selection", () => {
		const { onOpenFile } = renderPanel();

		act(() => {
			useFileTreeOptionsRef.current?.onSelectionChange?.([
				"src/index.ts",
			]);
		});

		expect(onOpenFile).toHaveBeenCalledWith("/root/src/index.ts");
	});

	it("does not open files while extending multi-selection", () => {
		const { onOpenFile } = renderPanel();

		fireEvent.mouseDown(screen.getByText("index.ts"), { metaKey: true });
		act(() => {
			useFileTreeOptionsRef.current?.onSelectionChange?.([
				"src/index.ts",
			]);
		});
		fireEvent.click(screen.getByText("index.ts"), { metaKey: true });

		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("does not open directory rows", () => {
		const { onOpenFile } = renderPanel();

		fireEvent.click(screen.getByText("src"));

		expect(onOpenFile).not.toHaveBeenCalled();
	});

	it("persists inline rename events through the backend mutation", () => {
		renderPanel();
		const renaming = useFileTreeOptionsRef.current?.renaming;
		if (!renaming || typeof renaming === "boolean") {
			throw new Error("expected renaming config");
		}

		act(() => {
			renaming.onRename?.({
				destinationPath: "src/main.ts",
				isFolder: false,
				sourcePath: "src/index.ts",
			});
		});

		expect(renameMutateAsyncMock).toHaveBeenCalledWith({
			destinationPath: "src/main.ts",
			sourcePath: "src/index.ts",
		});
	});

	it("starts inline creation for a new file beside the context file", () => {
		renderPanel();

		fireEvent.click(screen.getByRole("menuitem", { name: "New File" }));

		expect(addPathMock).toHaveBeenCalledWith("src/New File");
		expect(startRenamingMock).toHaveBeenCalledWith("src/New File", {
			removeIfCanceled: true,
		});
		expect(closeContextMenuMock).toHaveBeenCalledWith({
			restoreFocus: false,
		});
	});

	it("shows root actions from the file tree empty area context menu", async () => {
		renderPanel();

		fireEvent.contextMenu(screen.getByTestId("pierre-tree"), {
			clientX: 30,
			clientY: 40,
		});
		fireEvent.click(getLastMenuItem("Reveal in Finder"));

		await waitFor(() => {
			expect(revealMutateAsyncMock).toHaveBeenCalledWith({
				path: "/root",
			});
		});
	});

	it("copies the root relative path from the empty area context menu", async () => {
		renderPanel();

		fireEvent.contextMenu(screen.getByTestId("pierre-tree"), {
			clientX: 30,
			clientY: 40,
		});
		fireEvent.click(getLastMenuItem("Copy Relative Path"));

		expect(copyTextToClipboardMock).toHaveBeenCalledWith(".");
	});

	it("copies the root absolute path from the empty area context menu", async () => {
		renderPanel();

		fireEvent.contextMenu(screen.getByTestId("pierre-tree"), {
			clientX: 30,
			clientY: 40,
		});
		fireEvent.click(getLastMenuItem("Copy Absolute Path"));

		expect(copyTextToClipboardMock).toHaveBeenCalledWith("/root");
	});

	it("creates a file after the inline creation is renamed", () => {
		renderPanel();
		const renaming = useFileTreeOptionsRef.current?.renaming;
		if (!renaming || typeof renaming === "boolean") {
			throw new Error("expected renaming config");
		}

		fireEvent.click(screen.getByRole("menuitem", { name: "New File" }));
		act(() => {
			renaming.onRename?.({
				destinationPath: "src/config.json",
				isFolder: false,
				sourcePath: "src/New File",
			});
		});

		expect(createMutateAsyncMock).toHaveBeenCalledWith({
			kind: "file",
			path: "src/config.json",
		});
		expect(renameMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("starts inline creation for a new folder inside the context folder", () => {
		contextMenuItemRef.current = { kind: "directory", path: "src/" };
		renderPanel();

		fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));

		expect(addPathMock).toHaveBeenCalledWith("src/New Folder/");
		expect(startRenamingMock).toHaveBeenCalledWith("src/New Folder/", {
			removeIfCanceled: true,
		});
	});

	it("creates a folder after the inline creation is renamed", () => {
		contextMenuItemRef.current = { kind: "directory", path: "src/" };
		renderPanel();
		const renaming = useFileTreeOptionsRef.current?.renaming;
		if (!renaming || typeof renaming === "boolean") {
			throw new Error("expected renaming config");
		}

		fireEvent.click(screen.getByRole("menuitem", { name: "New Folder" }));
		act(() => {
			renaming.onRename?.({
				destinationPath: "src/components/",
				isFolder: true,
				sourcePath: "src/New Folder/",
			});
		});

		expect(createMutateAsyncMock).toHaveBeenCalledWith({
			kind: "directory",
			path: "src/components/",
		});
		expect(renameMutateAsyncMock).not.toHaveBeenCalled();
	});

	it("allows folder rename when Trees passes the public folder path", () => {
		renderPanel();
		const renaming = useFileTreeOptionsRef.current?.renaming;
		if (!renaming || typeof renaming === "boolean") {
			throw new Error("expected renaming config");
		}

		expect(renaming.canRename?.({ isFolder: true, path: "src" })).toBe(
			true,
		);
	});

	it("persists drag and drop events through the backend mutation", () => {
		renderPanel();
		const dragAndDrop = useFileTreeOptionsRef.current?.dragAndDrop;
		if (!dragAndDrop || typeof dragAndDrop === "boolean") {
			throw new Error("expected drag and drop config");
		}

		act(() => {
			dragAndDrop.onDropComplete?.({
				draggedPaths: ["src/index.ts"],
				operation: "move",
				target: {
					directoryPath: "src/",
					flattenedSegmentPath: null,
					hoveredPath: "src/",
					kind: "directory",
				},
			});
		});

		expect(moveMutateAsyncMock).toHaveBeenCalledWith({
			sourcePaths: ["src/index.ts"],
			targetDirPath: "src/",
		});
	});

	it("deletes context menu paths directly", async () => {
		renderPanel();

		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

		await waitFor(() => {
			expect(deleteMutateAsyncMock).toHaveBeenCalledWith({
				paths: ["src/index.ts"],
			});
		});
		expect(closeContextMenuMock).toHaveBeenCalledWith({
			restoreFocus: false,
		});
	});

	it("reveals context menu paths in Finder", async () => {
		renderPanel();

		fireEvent.click(
			screen.getByRole("menuitem", { name: "Reveal in Finder" }),
		);

		await waitFor(() => {
			expect(revealMutateAsyncMock).toHaveBeenCalledWith({
				path: "/root/src/index.ts",
			});
		});
		expect(closeContextMenuMock).toHaveBeenCalled();
	});

	it("opens context menu paths in the default app", async () => {
		renderPanel();

		fireEvent.click(
			screen.getByRole("menuitem", { name: "Open in Default App" }),
		);

		await waitFor(() => {
			expect(openDefaultAppMutateAsyncMock).toHaveBeenCalledWith({
				path: "/root/src/index.ts",
			});
		});
		expect(closeContextMenuMock).toHaveBeenCalled();
	});

	it("allows deleting status-only hidden files", async () => {
		contextMenuItemRef.current = { kind: "file", path: ".DS_Store" };
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[{ path: ".DS_Store", status: "untracked" }],
				false,
			),
		);
		renderPanel();

		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

		await waitFor(() => {
			expect(deleteMutateAsyncMock).toHaveBeenCalledWith({
				paths: [".DS_Store"],
			});
		});
	});

	it("does not allow deleting status-only deleted files", () => {
		contextMenuItemRef.current = { kind: "file", path: "deleted.ts" };
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult(
				[{ path: "deleted.ts", status: "deleted" }],
				false,
			),
		);
		renderPanel();

		expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
	});

	it("shows a toast when deleting fails", async () => {
		deleteMutateAsyncMock.mockRejectedValue(new Error("permission denied"));
		renderPanel();

		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

		await waitFor(() => {
			expect(toasterCreateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "permission denied",
					type: "error",
				}),
			);
		});
	});
});
