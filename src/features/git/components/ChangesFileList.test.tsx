import { ChakraProvider } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSystem } from "@/theme/system";
import ChangesFileList from "./ChangesFileList";

vi.mock("@/shared/components/OverflowTooltipText", () => ({
	default: ({
		displayValue,
	}: {
		displayValue: string;
	}) => <span>{displayValue}</span>,
}));

const file = {
	name: "src/index.ts",
	type: "change",
	hunks: [],
} as unknown as FileDiffMetadata;

function renderList(props?: Partial<ComponentProps<typeof ChangesFileList>>) {
	const onSelect = vi.fn();
	const onOpenFile = vi.fn();
	const onDiscardFile = vi.fn().mockResolvedValue(undefined);

	render(
		<ChakraProvider value={appSystem}>
			<ChangesFileList
				files={[file]}
				selectedIndex={0}
				includedFileNames={new Set([file.name])}
				onSelect={onSelect}
				onToggleIncluded={vi.fn()}
				onOpenFile={onOpenFile}
				onDiscardFile={onDiscardFile}
				onIncludeAll={vi.fn()}
				onIncludeNone={vi.fn()}
				{...props}
			/>
		</ChakraProvider>,
	);

	return { onSelect, onOpenFile, onDiscardFile };
}

describe("changesFileList", () => {
	beforeEach(() => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
	});

	it("opens the file callback on double click", () => {
		const { onOpenFile } = renderList();

		fireEvent.doubleClick(screen.getByTestId("git-file-list-item"));

		expect(onOpenFile).toHaveBeenCalledWith(file);
	});

	it("shows a context menu and discards the selected file", async () => {
		const { onSelect, onDiscardFile } = renderList();

		fireEvent.contextMenu(screen.getByTestId("git-file-list-item"), {
			clientX: 48,
			clientY: 64,
		});

		expect(onSelect).toHaveBeenCalledWith(0);

		fireEvent.click(
			screen.getByRole("button", { name: "gitDiscardFileAction" }),
		);

		await waitFor(() => expect(onDiscardFile).toHaveBeenCalledWith(file));
		expect(
			screen.queryByRole("button", { name: "gitDiscardFileAction" }),
		).not.toBeInTheDocument();
	});
});
