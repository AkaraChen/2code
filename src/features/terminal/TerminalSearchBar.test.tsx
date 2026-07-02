import type { SearchAddon } from "@xterm/addon-search";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalSearchBar } from "./TerminalSearchBar";

type SearchResultListener = (event: {
	resultIndex: number;
	resultCount: number;
}) => void;

function createSearchAddon() {
	let listener: SearchResultListener | null = null;
	const dispose = vi.fn();
	const searchAddon = {
		findNext: vi.fn(),
		findPrevious: vi.fn(),
		clearDecorations: vi.fn(),
		onDidChangeResults: vi.fn((callback: SearchResultListener) => {
			listener = callback;
			return { dispose };
		}),
	} as unknown as SearchAddon;

	return {
		dispose,
		searchAddon,
		emitResult(event: { resultIndex: number; resultCount: number }) {
			listener?.(event);
		},
	};
}

function renderSearchBar() {
	const onClose = vi.fn();
	const search = createSearchAddon();
	render(
		<TerminalSearchBar
			searchAddon={search.searchAddon}
			onClose={onClose}
		/>,
	);
	return { ...search, onClose };
}

describe("terminalSearchBar", () => {
	it("searches forward while typing", () => {
		const { searchAddon } = renderSearchBar();

		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "error" },
		});

		expect(searchAddon.findNext).toHaveBeenCalledWith(
			"error",
			expect.objectContaining({ incremental: true }),
		);
	});

	it("searches previous on Shift+Enter", () => {
		const { searchAddon } = renderSearchBar();
		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "error" } });

		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

		expect(searchAddon.findPrevious).toHaveBeenCalledWith(
			"error",
			expect.objectContaining({ incremental: true }),
		);
	});

	it("updates the result counter", () => {
		const { emitResult } = renderSearchBar();
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "error" },
		});

		act(() => {
			emitResult({ resultIndex: 1, resultCount: 3 });
		});

		expect(screen.getByText("2/3")).toBeInTheDocument();
	});

	it("clears decorations and closes on Escape", () => {
		const { onClose, searchAddon } = renderSearchBar();

		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

		expect(searchAddon.clearDecorations).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});
});
