import { describe, expect, it } from "vitest";
import { findSearchMatches, isSearchShortcut } from "./useSearch";

describe("useSearch utilities", () => {
	it("finds case-insensitive matches with line and column positions", () => {
		expect(
			findSearchMatches("Alpha beta\nalpha gamma\nnone", "alpha"),
		).toEqual([
			{ columnIndex: 0, lineNumber: 1 },
			{ columnIndex: 0, lineNumber: 2 },
		]);
	});

	it("detects browser-like search shortcuts", () => {
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: true,
				key: "f",
				metaKey: false,
				shiftKey: false,
			}),
		).toBe(true);
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: false,
				key: "F",
				metaKey: true,
				shiftKey: false,
			}),
		).toBe(true);
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: true,
				key: "f",
				metaKey: false,
				shiftKey: true,
			}),
		).toBe(false);
	});
});
