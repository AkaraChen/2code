import { describe, expect, it } from "vitest";
import {
	buildSortableId,
	FILE_SORTABLE_PREFIX,
	parseSortableId,
	resolveSortableReorder,
	TERMINAL_SORTABLE_PREFIX,
} from "./tabSorting";

describe("tabSorting", () => {
	it("builds stable sortable ids from terminal tab ids", () => {
		const firstOrder = ["session-a", "session-b", "session-c"];
		const reordered = ["session-b", "session-c", "session-a"];

		const firstIds = firstOrder.map((id) =>
			buildSortableId(TERMINAL_SORTABLE_PREFIX, id),
		);
		const reorderedIds = reordered.map((id) =>
			buildSortableId(TERMINAL_SORTABLE_PREFIX, id),
		);

		expect(firstIds[0]).toBe(reorderedIds[2]);
		expect(firstIds[1]).toBe(reorderedIds[0]);
	});

	it("parses file sortable ids with path separators and colons", () => {
		const filePath = "C:/workspace/src/features/terminal/TerminalTabs.tsx";
		const sortableId = buildSortableId(FILE_SORTABLE_PREFIX, filePath);

		expect(parseSortableId(sortableId)).toEqual({
			kind: FILE_SORTABLE_PREFIX,
			value: filePath,
		});
	});

	it("resolves terminal reorders using current tab ids instead of stale indexes", () => {
		expect(
			resolveSortableReorder(
				buildSortableId(TERMINAL_SORTABLE_PREFIX, "session-a"),
				buildSortableId(TERMINAL_SORTABLE_PREFIX, "session-c"),
				["session-b", "session-c", "session-a"],
				["/tmp/notes.md"],
			),
		).toEqual({
			kind: TERMINAL_SORTABLE_PREFIX,
			fromIndex: 2,
			toIndex: 1,
		});
	});

	it("keeps mixed tab boundary reorders pinned to the same edge", () => {
		expect(
			resolveSortableReorder(
				buildSortableId(FILE_SORTABLE_PREFIX, "/tmp/b.txt"),
				buildSortableId(TERMINAL_SORTABLE_PREFIX, "session-a"),
				["session-a", "session-b"],
				["/tmp/a.txt", "/tmp/b.txt"],
			),
		).toEqual({
			kind: FILE_SORTABLE_PREFIX,
			fromIndex: 1,
			toIndex: 0,
		});

		expect(
			resolveSortableReorder(
				buildSortableId(TERMINAL_SORTABLE_PREFIX, "session-a"),
				buildSortableId(FILE_SORTABLE_PREFIX, "/tmp/a.txt"),
				["session-a", "session-b"],
				["/tmp/a.txt", "/tmp/b.txt"],
			),
		).toEqual({
			kind: TERMINAL_SORTABLE_PREFIX,
			fromIndex: 0,
			toIndex: 1,
		});
	});

	it("returns null for unknown sortable ids", () => {
		expect(
			resolveSortableReorder(
				"terminal:missing",
				buildSortableId(TERMINAL_SORTABLE_PREFIX, "session-a"),
				["session-a"],
				[],
			),
		).toBeNull();
	});
});
