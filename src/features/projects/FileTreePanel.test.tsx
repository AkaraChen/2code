import { ChakraProvider } from "@chakra-ui/react";
import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@/generated/types";
import { appSystem } from "@/theme/system";
import FileTreePanel from "./FileTreePanel";
import { useDirectoryListing } from "./hooks";

vi.mock("./hooks", () => ({
	useDirectoryListing: vi.fn(),
}));

vi.mock("./FileViewerDialog", () => ({
	default: () => null,
}));

const rootPath = "/root";
const folderEntry: FileEntry = {
	name: "src",
	path: "/root/src",
	is_dir: true,
};
const childEntry: FileEntry = {
	name: "index.ts",
	path: "/root/src/index.ts",
	is_dir: false,
};

type DirectoryListingResult = ReturnType<typeof useDirectoryListing>;

function createDirectoryListingResult(
	data: FileEntry[] | undefined,
	isLoading: boolean,
): DirectoryListingResult {
	return {
		data,
		isLoading,
	} as DirectoryListingResult;
}

describe("fileTreePanel", () => {
	let folderState: "loading" | "loaded";

	beforeEach(() => {
		folderState = "loading";

		vi.mocked(useDirectoryListing).mockImplementation((path, enabled = true) => {
			if (path === rootPath) {
				return createDirectoryListingResult([folderEntry], false);
			}

			if (path === folderEntry.path && enabled) {
				if (folderState === "loading") {
					return createDirectoryListingResult(undefined, true);
				}

				return createDirectoryListingResult([childEntry], false);
			}

			return createDirectoryListingResult(undefined, false);
		});
	});

	it("keeps the expanded group mounted while uncached children are loading", async () => {
		const { rerender } = render(
			<ChakraProvider value={appSystem}>
				<FileTreePanel rootPath={rootPath} isOpen />
			</ChakraProvider>,
		);

		fireEvent.click(screen.getByText("src"));

		expect(
			screen.getByRole("status", { name: "Loading src" }),
		).toBeInTheDocument();
		expect(screen.queryByText("index.ts")).not.toBeInTheDocument();

		folderState = "loaded";
		rerender(
			<ChakraProvider value={appSystem}>
				<FileTreePanel rootPath={rootPath} isOpen />
			</ChakraProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("index.ts")).toBeInTheDocument();
		});
		expect(
			screen.queryByRole("status", { name: "Loading src" }),
		).not.toBeInTheDocument();
	});
});
