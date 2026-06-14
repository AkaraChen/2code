import { ChakraProvider } from "@chakra-ui/react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import FileViewerPane from "./FileViewerPane";
import {
	useFileViewerDirtyStore,
} from "./fileViewerTabsStore";
import { useFileContent, useFilePreview, useSaveFileContent } from "./hooks";

const { saveMutateMock } = vi.hoisted(() => ({
	saveMutateMock: vi.fn(),
}));

vi.mock("@/shared/lib/monaco", () => ({}));

vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@/features/projects/ArchivePreviewTree", () => ({
	default: ({
		entries,
		fileName,
	}: {
		entries: readonly { path: string }[];
		fileName: string;
	}) => (
		<div data-testid="archive-preview">
			<span>{fileName}</span>
			{entries.map((entry) => (
				<span key={entry.path}>{entry.path}</span>
			))}
		</div>
	),
}));

vi.mock("@/features/markdown/MarkdownEditor", () => ({
	default: ({
		initialMarkdown,
		onMarkdownChange,
		onRequestSave,
	}: {
		initialMarkdown: string;
		onMarkdownChange: (markdown: string) => void;
		onRequestSave?: (markdown: string) => void;
	}) => (
		<textarea
			aria-label="Markdown Editor"
			value={initialMarkdown}
			onChange={(event) => onMarkdownChange(event.currentTarget.value)}
			onKeyDown={(event) => {
				if (event.key.toLowerCase() !== "s" || !event.metaKey) return;
				event.preventDefault();
				onRequestSave?.(event.currentTarget.value);
			}}
		/>
	),
}));

vi.mock("@monaco-editor/react", () => ({
	default: ({
		language,
		onChange,
		path,
		theme,
		value,
	}: {
		language?: string;
		onChange?: (value: string | undefined) => void;
		path?: string;
		theme?: string;
		value?: string;
	}) => (
		<textarea
			aria-label="Monaco Editor"
			data-language={language}
			data-path={path}
			data-theme={theme}
			value={value ?? ""}
			onChange={(event) => onChange?.(event.currentTarget.value)}
		/>
	),
}));

vi.mock("./hooks", () => ({
	useFileContent: vi.fn(),
	useFilePreview: vi.fn(),
	useSaveFileContent: vi.fn(),
}));

vi.mock("@/features/terminal/hooks", () => ({
	useTerminalThemeId: () => "github-dark",
}));

const filePath = "src/index.ts";
const profileId = "profile-1";
const fileContent = [
	"function alpha() {}",
	"const beta = 1;",
	"function gamma() {}",
].join("\n");

type FileContentResult = ReturnType<typeof useFileContent>;
type FilePreviewResult = ReturnType<typeof useFilePreview>;
type SaveFileContentResult = ReturnType<typeof useSaveFileContent>;

function createVisibleRectList(): DOMRectList {
	const rect = new DOMRect(0, 0, 640, 480);
	return {
		0: rect,
		length: 1,
		item: (index: number) => (index === 0 ? rect : null),
		[Symbol.iterator]: function* iterator() {
			yield rect;
		},
	} as unknown as DOMRectList;
}

function renderPane(path = filePath) {
	return render(
		<ChakraProvider value={appSystem}>
			<FileViewerPane filePath={path} profileId={profileId} />
		</ChakraProvider>,
	);
}

function dirtyState() {
	return useFileViewerDirtyStore.getState();
}

describe("fileViewerPane", () => {
	let getClientRectsSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		saveMutateMock.mockReset();
		useFileViewerDirtyStore.setState({
			profiles: {},
			drafts: {},
			savedValues: {},
		});
		getClientRectsSpy = vi
			.spyOn(HTMLElement.prototype, "getClientRects")
			.mockReturnValue(createVisibleRectList());
		vi.mocked(useFileContent).mockReturnValue({
			data: fileContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult);
		vi.mocked(useFilePreview).mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: false,
			error: null,
		} as FilePreviewResult);
		vi.mocked(useSaveFileContent).mockReturnValue({
			error: null,
			isPending: false,
			mutate: saveMutateMock,
		} as unknown as SaveFileContentResult);
	});

	afterEach(() => {
		getClientRectsSpy.mockRestore();
	});

	it("renders Monaco with the file content and detected language", async () => {
		renderPane();

		const editor = await screen.findByLabelText("Monaco Editor");

		expect(editor).toHaveValue(fileContent);
		expect(editor).toHaveAttribute("data-language", "typescript");
		expect(editor).toHaveAttribute("data-path", filePath);
		expect(editor).toHaveAttribute("data-theme", "vs-dark");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders the file load error before content is available", () => {
		vi.mocked(useFileContent).mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
			error: new Error("read failed"),
		} as FileContentResult);

		renderPane();

		expect(screen.getByText("read failed")).toBeInTheDocument();
		expect(screen.queryByLabelText("Monaco Editor")).not.toBeInTheDocument();
	});

	it("marks the file dirty and saves edited content with Cmd+S", async () => {
		const nextContent = `${fileContent}\nconsole.log(beta);`;
		saveMutateMock.mockImplementation((_variables, options) => {
			options?.onSuccess?.(undefined, _variables);
		});
		renderPane();

		const editor = await screen.findByLabelText("Monaco Editor");
		fireEvent.change(editor, { target: { value: nextContent } });

		await waitFor(() => {
			expect(useFileViewerDirtyStore.getState().profiles[profileId]).toContain(
				filePath,
			);
		});

		act(() => {
			fireEvent.keyDown(window, { key: "s", metaKey: true });
		});

		expect(saveMutateMock).toHaveBeenCalledWith(
			{ path: filePath, content: nextContent },
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
		expect(useFileViewerDirtyStore.getState().profiles[profileId]).toBeUndefined();
		expect(dirtyState().drafts[profileId]?.[filePath]).toBe(nextContent);
		expect(dirtyState().savedValues[profileId]?.[filePath]).toBe(nextContent);
	});

	it("keeps unsaved edits when the pane unmounts and remounts", async () => {
		const nextContent = `${fileContent}\nconsole.log(beta);`;
		const { unmount } = renderPane();

		const editor = await screen.findByLabelText("Monaco Editor");
		fireEvent.change(editor, { target: { value: nextContent } });

		await waitFor(() => {
			expect(dirtyState().drafts[profileId]?.[filePath]).toBe(nextContent);
		});

		unmount();
		renderPane();

		expect(await screen.findByLabelText("Monaco Editor")).toHaveValue(nextContent);
		expect(useFileViewerDirtyStore.getState().profiles[profileId]).toContain(
			filePath,
		);
	});

	it("renders markdown files with the markdown editor and saves edited content", async () => {
		const markdownPath = "README.md";
		const markdownContent = "# Readme";
		const nextContent = `${markdownContent}\n\nUpdated.`;
		vi.mocked(useFileContent).mockReturnValue({
			data: markdownContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult);
		saveMutateMock.mockImplementation((_variables, options) => {
			options?.onSuccess?.(undefined, _variables);
		});

		renderPane(markdownPath);

		const editor = await screen.findByLabelText("Markdown Editor");
		expect(editor).toHaveValue(markdownContent);
		expect(screen.queryByLabelText("Monaco Editor")).not.toBeInTheDocument();

		fireEvent.change(editor, { target: { value: nextContent } });

		await waitFor(() => {
			expect(useFileViewerDirtyStore.getState().profiles[profileId]).toContain(
				markdownPath,
			);
		});

		act(() => {
			fireEvent.keyDown(editor, { key: "s", metaKey: true });
		});

		expect(saveMutateMock).toHaveBeenCalledWith(
			{ path: markdownPath, content: nextContent },
			expect.objectContaining({ onSuccess: expect.any(Function) }),
		);
		expect(useFileViewerDirtyStore.getState().profiles[profileId]).toBeUndefined();
	});

	it("does not leak markdown edits into Monaco when switching files", async () => {
		const markdownPath = "README.md";
		const markdownContent = "# Readme";
		const markdownDraft = `${markdownContent}\n\nUpdated.`;
		vi.mocked(useFileContent).mockImplementation((_profileId: string, p: string) => ({
			data: p === markdownPath ? markdownContent : fileContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult));

		const { rerender } = renderPane(markdownPath);

		const markdownEditor = await screen.findByLabelText("Markdown Editor");
		fireEvent.change(markdownEditor, { target: { value: markdownDraft } });

		rerender(
			<ChakraProvider value={appSystem}>
				<FileViewerPane filePath={filePath} profileId={profileId} />
			</ChakraProvider>,
		);

		const monacoEditor = await screen.findByLabelText("Monaco Editor");
		expect(monacoEditor).toHaveValue(fileContent);
		expect(monacoEditor).not.toHaveValue(markdownDraft);
		expect(dirtyState().drafts[profileId]?.[markdownPath]).toBe(markdownDraft);
	});

	it("does not restore discarded inactive edits when reopening a file", async () => {
		const markdownPath = "README.md";
		const markdownContent = "# Readme";
		const markdownDraft = `${markdownContent}\n\nUpdated.`;
		vi.mocked(useFileContent).mockImplementation((_profileId: string, p: string) => ({
			data: p === markdownPath ? markdownContent : fileContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult));

		const { rerender } = renderPane(markdownPath);

		const markdownEditor = await screen.findByLabelText("Markdown Editor");
		fireEvent.change(markdownEditor, { target: { value: markdownDraft } });

		rerender(
			<ChakraProvider value={appSystem}>
				<FileViewerPane filePath={filePath} profileId={profileId} />
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(dirtyState().drafts[profileId]?.[markdownPath]).toBe(markdownDraft);
		});

		act(() => {
			dirtyState().clearFileState(profileId, markdownPath);
		});

		rerender(
			<ChakraProvider value={appSystem}>
				<FileViewerPane filePath={markdownPath} profileId={profileId} />
			</ChakraProvider>,
		);

		expect(await screen.findByLabelText("Markdown Editor")).toHaveValue(
			markdownContent,
		);
		expect(dirtyState().drafts[profileId]?.[markdownPath]).toBeUndefined();
	});

	it("does not leak Monaco edits into markdown when switching files", async () => {
		const markdownPath = "README.md";
		const markdownContent = "# Readme";
		const codeDraft = `${fileContent}\nconsole.log(beta);`;
		vi.mocked(useFileContent).mockImplementation((_profileId: string, p: string) => ({
			data: p === markdownPath ? markdownContent : fileContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult));

		const { rerender } = renderPane(filePath);

		const monacoEditor = await screen.findByLabelText("Monaco Editor");
		fireEvent.change(monacoEditor, { target: { value: codeDraft } });

		rerender(
			<ChakraProvider value={appSystem}>
				<FileViewerPane filePath={markdownPath} profileId={profileId} />
			</ChakraProvider>,
		);

		const markdownEditor = await screen.findByLabelText("Markdown Editor");
		expect(markdownEditor).toHaveValue(markdownContent);
		expect(markdownEditor).not.toHaveValue(codeDraft);
		expect(dirtyState().drafts[profileId]?.[filePath]).toBe(codeDraft);
	});

	it("renders image files with the binary preview instead of Monaco", async () => {
		const imagePath = "assets/logo.png";
		const previewPath = "/repo/assets/logo.png";
		vi.mocked(useFilePreview).mockReturnValue({
			data: {
				kind: "image",
				file_path: previewPath,
				mime_type: "image/png",
				source_path: null,
			},
			isLoading: false,
			isError: false,
			error: null,
		} as FilePreviewResult);

		renderPane(imagePath);

		const image = await screen.findByRole("img", { name: "logo.png" });
		expect(image).toHaveAttribute("src", expect.stringContaining(previewPath));
		expect(screen.queryByLabelText("Monaco Editor")).not.toBeInTheDocument();
		expect(useFileContent).toHaveBeenCalledWith("profile-1", imagePath, false);
		expect(useFilePreview).toHaveBeenCalledWith("profile-1", imagePath, true);
	});

	it("renders Office previews as converted PDFs", async () => {
		const officePath = "docs/spec.docx";
		const officeSourcePath = "/repo/docs/spec.docx";
		const pdfPath = "/cache/spec.pdf";
		vi.mocked(useFilePreview).mockReturnValue({
			data: {
				kind: "office-pdf",
				file_path: pdfPath,
				mime_type: "application/pdf",
				source_path: officeSourcePath,
			},
			isLoading: false,
			isError: false,
			error: null,
		} as FilePreviewResult);

		renderPane(officePath);

		const frame = await screen.findByTitle("spec.docx");
		expect(frame).toHaveAttribute("src", expect.stringContaining(pdfPath));
		expect(screen.getByText("Office Preview")).toBeInTheDocument();
		expect(screen.queryByLabelText("Monaco Editor")).not.toBeInTheDocument();
	});

	it("renders archives with the archive tree preview", async () => {
		const archivePath = "archive.zip";
		const archivePreviewPath = "/repo/archive.zip";
		vi.mocked(useFilePreview).mockReturnValue({
			data: {
				kind: "archive",
				file_path: archivePreviewPath,
				mime_type: "application/x-archive",
				source_path: null,
				archive_entries: [
					{ path: "src/", kind: "directory", size: null },
					{ path: "src/index.ts", kind: "file", size: 42 },
				],
			},
			isLoading: false,
			isError: false,
			error: null,
		} as FilePreviewResult);

		renderPane(archivePath);

		expect(await screen.findByTestId("archive-preview")).toBeInTheDocument();
		expect(screen.getByText("archive.zip")).toBeInTheDocument();
		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.queryByLabelText("Monaco Editor")).not.toBeInTheDocument();
		expect(useFileContent).toHaveBeenCalledWith("profile-1", archivePath, false);
	});
});
