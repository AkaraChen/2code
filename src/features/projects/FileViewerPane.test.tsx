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
import { useFileContent, useSaveFileContent } from "./hooks";

const { saveMutateMock } = vi.hoisted(() => ({
	saveMutateMock: vi.fn(),
}));

vi.mock("@/shared/lib/monaco", () => ({}));

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
	useSaveFileContent: vi.fn(),
}));

vi.mock("@/features/terminal/hooks", () => ({
	useTerminalThemeId: () => "github-dark",
}));

const filePath = "/repo/src/index.ts";
const profileId = "profile-1";
const fileContent = [
	"function alpha() {}",
	"const beta = 1;",
	"function gamma() {}",
].join("\n");

type FileContentResult = ReturnType<typeof useFileContent>;
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

function renderPane() {
	return render(
		<ChakraProvider value={appSystem}>
			<FileViewerPane filePath={filePath} profileId={profileId} />
		</ChakraProvider>,
	);
}

describe("fileViewerPane", () => {
	let getClientRectsSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		saveMutateMock.mockReset();
		useFileViewerDirtyStore.setState({ profiles: {} });
		getClientRectsSpy = vi
			.spyOn(HTMLElement.prototype, "getClientRects")
			.mockReturnValue(createVisibleRectList());
		vi.mocked(useFileContent).mockReturnValue({
			data: fileContent,
			isLoading: false,
			isError: false,
			error: null,
		} as FileContentResult);
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
	});
});
