import { ChakraProvider } from "@chakra-ui/react";
import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import FileViewerPane from "./FileViewerPane";
import { useFileContent } from "./hooks";

vi.mock("./hooks", () => ({
	useFileContent: vi.fn(),
}));

vi.mock("@/features/terminal/hooks", () => ({
	useTerminalThemeId: () => "github-dark",
}));

const fileContent = [
	"function alpha() {}",
	"const beta = 1;",
	"function gamma() {}",
].join("\n");

type FileContentResult = ReturnType<typeof useFileContent>;

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
			<FileViewerPane filePath="/repo/src/index.ts" />
		</ChakraProvider>,
	);
}

describe("fileViewerPane", () => {
	let getClientRectsSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		getClientRectsSpy = vi
			.spyOn(HTMLElement.prototype, "getClientRects")
			.mockReturnValue(createVisibleRectList());

		vi.mocked(useFileContent).mockReturnValue({
			data: fileContent,
			isLoading: false,
			error: null,
		} as FileContentResult);
	});

	afterEach(() => {
		getClientRectsSpy.mockRestore();
	});

	it("opens and focuses file search with Cmd+F", async () => {
		renderPane();

		fireEvent.keyDown(window, { key: "f", metaKey: true });

		const searchInput = await screen.findByRole("searchbox", {
			name: "fileViewerFindInFile",
		});
		await waitFor(() => expect(searchInput).toHaveFocus());
	});

	it("supports browser-like match navigation from the search input", async () => {
		renderPane();

		fireEvent.keyDown(window, { key: "f", ctrlKey: true });
		const searchInput = await screen.findByRole("searchbox", {
			name: "fileViewerFindInFile",
		});

		fireEvent.change(searchInput, { target: { value: "function" } });

		await waitFor(() => {
			expect(screen.getByText("1/2")).toBeInTheDocument();
		});

		fireEvent.keyDown(searchInput, { key: "Enter" });

		await waitFor(() => {
			expect(screen.getByText("2/2")).toBeInTheDocument();
		});

		fireEvent.keyDown(searchInput, { key: "Escape" });

		await waitFor(() => {
			expect(
				screen.queryByRole("searchbox", {
					name: "fileViewerFindInFile",
				}),
			).not.toBeInTheDocument();
		});
	});
});
