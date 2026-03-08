import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { changeBadge, getLineStats } from "./utils";

describe("changeBadge", () => {
	it("maps 'new' to label 'A' with green palette", () => {
		expect(changeBadge.new).toEqual({ label: "A", colorPalette: "green" });
	});

	it("maps 'deleted' to label 'D' with red palette", () => {
		expect(changeBadge.deleted).toEqual({
			label: "D",
			colorPalette: "red",
		});
	});

	it("maps 'change' to label 'M' with blue palette", () => {
		expect(changeBadge.change).toEqual({
			label: "M",
			colorPalette: "blue",
		});
	});

	it("maps 'rename-pure' to label 'R' with yellow palette", () => {
		expect(changeBadge["rename-pure"]).toEqual({
			label: "R",
			colorPalette: "yellow",
		});
	});

	it("maps 'rename-changed' to label 'R' with yellow palette", () => {
		expect(changeBadge["rename-changed"]).toEqual({
			label: "R",
			colorPalette: "yellow",
		});
	});

	it("returns undefined for unknown change type", () => {
		expect(changeBadge.nonexistent).toBeUndefined();
	});
});

function makeFile(
	hunks: Array<{
		hunkContent: Array<
			| { type: "context" }
			| { type: "change"; additions: string[]; deletions: string[] }
		>;
	}>,
): FileDiffMetadata {
	return { hunks } as unknown as FileDiffMetadata;
}

describe("getLineStats", () => {
	it("returns zero for file with no hunks", () => {
		expect(getLineStats(makeFile([]))).toEqual({
			additions: 0,
			deletions: 0,
		});
	});

	it("returns zero for hunks with only context content", () => {
		const file = makeFile([{ hunkContent: [{ type: "context" }] }]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 0 });
	});

	it("counts additions and deletions from a single change", () => {
		const file = makeFile([
			{
				hunkContent: [
					{
						type: "change",
						additions: ["a", "b"],
						deletions: ["c"],
					},
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 2, deletions: 1 });
	});

	it("accumulates across multiple changes in one hunk", () => {
		const file = makeFile([
			{
				hunkContent: [
					{
						type: "change",
						additions: ["a"],
						deletions: ["b", "c"],
					},
					{
						type: "change",
						additions: ["d", "e", "f"],
						deletions: [],
					},
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 4, deletions: 2 });
	});

	it("accumulates across multiple hunks", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: ["a"], deletions: ["b"] },
				],
			},
			{
				hunkContent: [
					{
						type: "change",
						additions: ["c", "d"],
						deletions: ["e"],
					},
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 3, deletions: 2 });
	});

	it("ignores context content mixed with changes", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "context" },
					{ type: "change", additions: ["a"], deletions: [] },
					{ type: "context" },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 1, deletions: 0 });
	});

	it("handles empty additions/deletions arrays", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: [], deletions: ["x"] },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 1 });
	});

	it("handles change with both arrays empty", () => {
		const file = makeFile([
			{
				hunkContent: [{ type: "change", additions: [], deletions: [] }],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 0 });
	});

	it("handles hunk with empty hunkContent array", () => {
		const file = makeFile([{ hunkContent: [] }]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 0 });
	});

	it("handles large number of hunks", () => {
		const hunks = Array.from({length: 100}).fill({
			hunkContent: [
				{
					type: "change" as const,
					additions: ["a"],
					deletions: ["b", "c"],
				},
			],
		});
		expect(getLineStats(makeFile(hunks))).toEqual({
			additions: 100,
			deletions: 200,
		});
	});

	it("handles only-additions file (no deletions anywhere)", () => {
		const file = makeFile([
			{
				hunkContent: [
					{
						type: "change",
						additions: ["a", "b", "c"],
						deletions: [],
					},
				],
			},
			{
				hunkContent: [
					{ type: "change", additions: ["d"], deletions: [] },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 4, deletions: 0 });
	});

	it("handles only-deletions file (no additions anywhere)", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: [], deletions: ["a", "b"] },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 2 });
	});

	it("handles unknown content type gracefully (ignored)", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "unknown-type" } as never,
					{ type: "change", additions: ["a"], deletions: [] },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 1, deletions: 0 });
	});
});
