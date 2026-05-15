import { describe, expect, it } from "vitest";
import { findSearchMatches, isSearchShortcut } from "./useSearch";

describe("findSearchMatches", () => {
	it("finds case-insensitive matches across lines", () => {
		expect(findSearchMatches("Alpha\nbeta ALPHA", "alpha")).toEqual([
			{ columnIndex: 0, lineNumber: 1 },
			{ columnIndex: 5, lineNumber: 2 },
		]);
	});

	it("returns no matches for an empty query", () => {
		expect(findSearchMatches("content", "")).toEqual([]);
	});
});

describe("isSearchShortcut", () => {
	it("accepts command/control f without alternate modifiers", () => {
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: true,
				key: "F",
				metaKey: false,
				shiftKey: false,
			}),
		).toBe(true);
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: false,
				key: "f",
				metaKey: true,
				shiftKey: false,
			}),
		).toBe(true);
	});

	it("rejects search shortcuts with alternate modifiers", () => {
		expect(
			isSearchShortcut({
				altKey: false,
				ctrlKey: true,
				key: "f",
				metaKey: false,
				shiftKey: true,
			}),
		).toBe(false);
		expect(
			isSearchShortcut({
				altKey: true,
				ctrlKey: false,
				key: "f",
				metaKey: true,
				shiftKey: false,
			}),
		).toBe(false);
	});
});
