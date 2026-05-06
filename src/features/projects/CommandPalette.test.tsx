import { ChakraProvider } from "@chakra-ui/react";
import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSearchResult } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { appSystem } from "@/theme/system";
import { useFileViewerTabsStore } from "./fileViewerTabsStore";
import CommandPalette from "./CommandPalette";
import { useFileSearch } from "./hooks";

vi.mock("./hooks", () => ({
	useFileSearch: vi.fn(),
}));

const fileResults: FileSearchResult[] = [
	{
		name: "main.ts",
		path: "/repo/src/main.ts",
		relative_path: "src/main.ts",
	},
	{
		name: "README.md",
		path: "/repo/README.md",
		relative_path: "README.md",
	},
];

type FileSearchQueryResult = ReturnType<typeof useFileSearch>;

function createFileSearchResult(
	result: Pick<FileSearchQueryResult, "data" | "error" | "isError" | "isFetching">,
): FileSearchQueryResult {
	return result as unknown as FileSearchQueryResult;
}

function renderPalette() {
	return render(
		<ChakraProvider value={appSystem}>
			<CommandPalette profileId="profile-1" />
		</ChakraProvider>,
	);
}

function resetStores() {
	useFileViewerTabsStore.setState({ profiles: {} });
	localStorage.clear();
}

describe("commandPalette", () => {
	beforeEach(() => {
		resetStores();

		vi.mocked(useFileSearch).mockImplementation(
			(_profileId, query, enabled = true) =>
				createFileSearchResult({
					data:
						enabled && query
							? fileResults.filter(
									(result) =>
										result.name.includes(query) ||
										result.relative_path.includes(query),
								)
							: [],
					error: null,
					isError: false,
					isFetching: false,
				}),
		);
	});

	it("opens a cmdk dialog from the keyboard shortcut", async () => {
		renderPalette();

		fireEvent.keyDown(window, { key: "k", metaKey: true });

		const input = await screen.findByRole("combobox", {
			name: m.commandPaletteTitle(),
		});
		await waitFor(() => expect(input).toHaveFocus());
		expect(document.querySelector("[cmdk-root]")).toBeInTheDocument();
		expect(screen.getByText(m.commandPaletteEmpty())).toBeInTheDocument();
	});

	it("opens the current file selection with Enter", async () => {
		renderPalette();

		fireEvent.keyDown(window, { key: "k", ctrlKey: true });

		const input = await screen.findByRole("combobox", {
			name: m.commandPaletteTitle(),
		});
		fireEvent.change(input, { target: { value: "main" } });

		await waitFor(() => {
			expect(screen.getByText("main.ts")).toBeInTheDocument();
		});
		expect(
			screen
				.getByText("main.ts")
				.closest("[cmdk-item]")
				?.querySelector("svg[data-icon-token='typescript']"),
		).not.toBeNull();
		await waitFor(() => {
			expect(
				document.querySelector("[cmdk-item][aria-selected='true']"),
			).toHaveTextContent("main.ts");
		});

		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => {
			expect(
				useFileViewerTabsStore.getState().profiles["profile-1"]?.activeFilePath,
			).toBe("/repo/src/main.ts");
		});
		expect(
			screen.queryByRole("combobox", {
				name: m.commandPaletteTitle(),
			}),
		).not.toBeInTheDocument();
	});

	it("shows a search error in the empty state layout", async () => {
		vi.mocked(useFileSearch).mockReturnValue(
			createFileSearchResult({
				data: [],
				error: new Error("search failed"),
				isError: true,
				isFetching: false,
			}),
		);

		renderPalette();

		fireEvent.keyDown(window, { key: "k", metaKey: true });

		await screen.findByRole("combobox", {
			name: m.commandPaletteTitle(),
		});

		expect(screen.getByText("search failed")).toBeInTheDocument();
	});
});
