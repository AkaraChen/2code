import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import {
	changeBadge,
	getGitBinaryPreviewPath,
	getGitBinaryPreviewRevision,
	getLineStats,
	getPreviewableImageMimeType,
	isBinaryImageDiffPreviewable,
	reconcileIncludedFiles,
} from "./utils";

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
			| { type: "change"; additions: number; deletions: number }
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
						additions: 2,
						deletions: 1,
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
						additions: 1,
						deletions: 2,
					},
					{
						type: "change",
						additions: 3,
						deletions: 0,
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
					{ type: "change", additions: 1, deletions: 1 },
				],
			},
			{
				hunkContent: [
					{
						type: "change",
						additions: 2,
						deletions: 1,
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
					{ type: "change", additions: 1, deletions: 0 },
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
					{ type: "change", additions: 0, deletions: 1 },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 1 });
	});

	it("handles change with both arrays empty", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: 0, deletions: 0 },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 0 });
	});

	it("handles hunk with empty hunkContent array", () => {
		const file = makeFile([{ hunkContent: [] }]);
		expect(getLineStats(file)).toEqual({ additions: 0, deletions: 0 });
	});

	it("handles large number of hunks", () => {
		const hunks = Array.from({ length: 100 }, () => ({
			hunkContent: [
				{
					type: "change" as const,
					additions: 1,
					deletions: 2,
				},
			],
		}));
		expect(getLineStats(makeFile(hunks))).toEqual({
			additions: 100,
			deletions: 200,
		});
	});

	it("handles only-additions file (no deletions anywhere)", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: 3, deletions: 0 },
				],
			},
			{
				hunkContent: [
					{ type: "change", additions: 1, deletions: 0 },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 4, deletions: 0 });
	});

	it("handles only-deletions file (no additions anywhere)", () => {
		const file = makeFile([
			{
				hunkContent: [
					{ type: "change", additions: 0, deletions: 2 },
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
					{ type: "change", additions: 1, deletions: 0 },
				],
			},
		]);
		expect(getLineStats(file)).toEqual({ additions: 1, deletions: 0 });
	});
});

describe("reconcileIncludedFiles", () => {
	it("includes all files on first load", () => {
		expect(
			reconcileIncludedFiles(
				["a.ts", "b.ts"],
				new Set<string>(),
				new Set<string>(),
			),
		).toEqual(new Set(["a.ts", "b.ts"]));
	});

	it("preserves existing exclusions for unchanged files", () => {
		expect(
			reconcileIncludedFiles(
				["a.ts", "b.ts"],
				new Set(["a.ts"]),
				new Set(["a.ts", "b.ts"]),
			),
		).toEqual(new Set(["a.ts"]));
	});

	it("auto-includes newly added files while keeping existing choices", () => {
		expect(
			reconcileIncludedFiles(
				["a.ts", "b.ts", "c.ts"],
				new Set(["a.ts"]),
				new Set(["a.ts", "b.ts"]),
			),
		).toEqual(new Set(["a.ts", "c.ts"]));
	});

	it("drops removed files from the included set", () => {
		expect(
			reconcileIncludedFiles(
				["b.ts"],
				new Set(["a.ts", "b.ts"]),
				new Set(["a.ts", "b.ts"]),
			),
		).toEqual(new Set(["b.ts"]));
	});
});

describe("getPreviewableImageMimeType", () => {
	it("recognizes common previewable image formats", () => {
		expect(getPreviewableImageMimeType("image.png")).toBe("image/png");
		expect(getPreviewableImageMimeType("image.JPG")).toBe("image/jpeg");
		expect(getPreviewableImageMimeType("image.webp")).toBe("image/webp");
		expect(getPreviewableImageMimeType("icon.ico")).toBe("image/x-icon");
		expect(getPreviewableImageMimeType("vector.svg")).toBe(
			"image/svg+xml",
		);
	});

	it("returns null for unsupported formats", () => {
		expect(getPreviewableImageMimeType("document.pdf")).toBeNull();
		expect(getPreviewableImageMimeType("README")).toBeNull();
	});
});

describe("isBinaryImageDiffPreviewable", () => {
	it("returns true for image diffs without hunks", () => {
		expect(
			isBinaryImageDiffPreviewable({
				name: "assets/preview.png",
				type: "change",
				hunks: [],
			} as unknown as FileDiffMetadata),
		).toBe(true);
	});

	it("returns true for rename-changed image diffs without hunks", () => {
		expect(
			isBinaryImageDiffPreviewable({
				name: "after.webp",
				prevName: "before.png",
				type: "rename-changed",
				hunks: [],
			} as unknown as FileDiffMetadata),
		).toBe(true);
	});

	it("returns false for non-image files, pure renames, or text hunks", () => {
		expect(
			isBinaryImageDiffPreviewable({
				name: "archive.zip",
				type: "change",
				hunks: [],
			} as unknown as FileDiffMetadata),
		).toBe(false);
		expect(
			isBinaryImageDiffPreviewable({
				name: "same.png",
				prevName: "old.png",
				type: "rename-pure",
				hunks: [],
			} as unknown as FileDiffMetadata),
		).toBe(false);
		expect(
			isBinaryImageDiffPreviewable({
				name: "vector.svg",
				type: "change",
				hunks: [{ hunkContent: [] }],
			} as unknown as FileDiffMetadata),
		).toBe(false);
	});
});

describe("getGitBinaryPreviewPath", () => {
	it("returns the correct path for before and after sides", () => {
		expect(
			getGitBinaryPreviewPath(
				{
					name: "next.png",
					prevName: "prev.png",
					type: "rename-changed",
				} as unknown as FileDiffMetadata,
				"before",
			),
		).toBe("prev.png");
		expect(
			getGitBinaryPreviewPath(
				{
					name: "next.png",
					prevName: "prev.png",
					type: "rename-changed",
				} as unknown as FileDiffMetadata,
				"after",
			),
		).toBe("next.png");
	});

	it("omits missing sides for added and deleted files", () => {
		expect(
			getGitBinaryPreviewPath(
				{
					name: "new.png",
					type: "new",
				} as unknown as FileDiffMetadata,
				"before",
			),
		).toBeNull();
		expect(
			getGitBinaryPreviewPath(
				{
					name: "gone.png",
					type: "deleted",
				} as unknown as FileDiffMetadata,
				"after",
			),
		).toBeNull();
	});
});

describe("getGitBinaryPreviewRevision", () => {
	it("prefers object ids for cache busting", () => {
		expect(
			getGitBinaryPreviewRevision(
				{
					name: "next.png",
					prevName: "prev.png",
					prevObjectId: "abc123",
					newObjectId: "def456",
				} as unknown as FileDiffMetadata,
				"before",
			),
		).toBe("abc123");
		expect(
			getGitBinaryPreviewRevision(
				{
					name: "next.png",
					prevName: "prev.png",
					prevObjectId: "abc123",
					newObjectId: "def456",
				} as unknown as FileDiffMetadata,
				"after",
			),
		).toBe("def456");
	});

	it("falls back to names when object ids are missing", () => {
		expect(
			getGitBinaryPreviewRevision(
				{
					name: "next.png",
					prevName: "prev.png",
				} as unknown as FileDiffMetadata,
				"before",
			),
		).toBe("prev.png");
		expect(
			getGitBinaryPreviewRevision(
				{
					name: "next.png",
				} as unknown as FileDiffMetadata,
				"after",
			),
		).toBe("next.png");
	});
});
