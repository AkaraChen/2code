import { ChakraProvider } from "@chakra-ui/react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { FileTreeOptions } from "@pierre/trees";
import type { MouseEventHandler } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import FileTreePanel from "./FileTreePanel";
import {
	useFileTreeGitStatus,
	useFileTreePaths,
	useMoveFileTreePaths,
	useRenameFileTreePath,
} from "./hooks";

const {
	moveMutateAsyncMock,
	renameMutateAsyncMock,
	resetPathsMock,
	setGitStatusMock,
	startRenamingMock,
	useFileTreeOptionsRef,
} = vi.hoisted(() => ({
	moveMutateAsyncMock: vi.fn(),
	renameMutateAsyncMock: vi.fn(),
	resetPathsMock: vi.fn(),
	setGitStatusMock: vi.fn(),
	startRenamingMock: vi.fn(),
	useFileTreeOptionsRef: {
		current: null as null | FileTreeOptions,
	},
}));

vi.mock("@pierre/trees/react", () => ({
	FileTree: ({
		onClick,
		onMouseDown,
	}: {
		onClick?: MouseEventHandler<HTMLElement>;
		onMouseDown?: MouseEventHandler<HTMLElement>;
	}) => (
		<div data-testid="pierre-tree">
			<button
				data-item-path="src/"
				onClick={onClick as MouseEventHandler<HTMLButtonElement>}
				onMouseDown={onMouseDown as MouseEventHandler<HTMLButtonElement>}
				type="button"
			>
				src
			</button>
			<button
				data-item-path="src/index.ts"
				onClick={onClick as MouseEventHandler<HTMLButtonElement>}
				onMouseDown={onMouseDown as MouseEventHandler<HTMLButtonElement>}
				type="button"
			>
				index.ts
			</button>
		</div>
	),
	useFileTree: vi.fn((options: FileTreeOptions) => {
		useFileTreeOptionsRef.current = options;
		return {
			model: {
				resetPaths: resetPathsMock,
				setGitStatus: setGitStatusMock,
				startRenaming: startRenamingMock,
			},
		};
	}),
}));

vi.mock("./hooks", () => ({
	useFileTreeGitStatus: vi.fn(),
	useFileTreePaths: vi.fn(),
	useMoveFileTreePaths: vi.fn(),
	useRenameFileTreePath: vi.fn(),
}));

vi.mock("./FileViewerDialog", () => ({
	default: () => null,
}));

const rootPath = "/root";
const profileId = "profile-1";
const treePaths = ["src/", "src/index.ts"];

type FileTreePathsResult = ReturnType<typeof useFileTreePaths>;
type FileTreeGitStatusResult = ReturnType<typeof useFileTreeGitStatus>;

function createFileTreePathsResult(
	data: string[] | undefined,
	isLoading: boolean,
): FileTreePathsResult {
	return {
		data,
		isLoading,
	} as FileTreePathsResult;
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

describe("fileTreePanel", () => {
	beforeEach(() => {
		moveMutateAsyncMock.mockReset();
		moveMutateAsyncMock.mockResolvedValue(undefined);
		renameMutateAsyncMock.mockReset();
		renameMutateAsyncMock.mockResolvedValue(undefined);
		resetPathsMock.mockReset();
		setGitStatusMock.mockReset();
		startRenamingMock.mockReset();
		useFileTreeOptionsRef.current = null;
		vi.mocked(useFileTreePaths).mockReturnValue(
			createFileTreePathsResult(treePaths, false),
		);
		vi.mocked(useFileTreeGitStatus).mockReturnValue(
			createFileTreeGitStatusResult([], false),
		);
		vi.mocked(useRenameFileTreePath).mockReturnValue({
			mutateAsync: renameMutateAsyncMock,
		} as unknown as ReturnType<typeof useRenameFileTreePath>);
		vi.mocked(useMoveFileTreePaths).mockReturnValue({
			mutateAsync: moveMutateAsyncMock,
		} as unknown as ReturnType<typeof useMoveFileTreePaths>);
	});

	it("resets the Pierre tree model with loaded paths", async () => {
		renderPanel();

		await waitFor(() => {
			expect(resetPathsMock).toHaveBeenCalledWith(treePaths);
		});
	});

	it("enables requested Pierre tree features", () => {
		renderPanel();

		expect(useFileTreeOptionsRef.current).toMatchObject({
			flattenEmptyDirectories: true,
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

	it("opens file rows from tree click events", () => {
		const { onOpenFile } = renderPanel();

		fireEvent.click(screen.getByText("index.ts"));

		expect(onOpenFile).toHaveBeenCalledWith("/root/src/index.ts");
	});

	it("opens selected files for keyboard selection", () => {
		const { onOpenFile } = renderPanel();

		act(() => {
			useFileTreeOptionsRef.current?.onSelectionChange?.(["src/index.ts"]);
		});

		expect(onOpenFile).toHaveBeenCalledWith("/root/src/index.ts");
	});

	it("does not open files while extending multi-selection", () => {
		const { onOpenFile } = renderPanel();

		fireEvent.mouseDown(screen.getByText("index.ts"), { metaKey: true });
		act(() => {
			useFileTreeOptionsRef.current?.onSelectionChange?.(["src/index.ts"]);
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

	it("allows folder rename when Trees passes the public folder path", () => {
		renderPanel();
		const renaming = useFileTreeOptionsRef.current?.renaming;
		if (!renaming || typeof renaming === "boolean") {
			throw new Error("expected renaming config");
		}

		expect(renaming.canRename?.({ isFolder: true, path: "src" })).toBe(true);
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
});
