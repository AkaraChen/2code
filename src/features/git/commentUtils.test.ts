import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import {
	formatGitDiffCommentLocation,
	formatGitDiffCommentPayload,
	formatSelectedLineRange,
	getGitDiffCommentAnchor,
	normalizeSelectedLineRange,
} from "./commentUtils";

const mockFile = {
	name: "src/features/git/components/GitDiffPane.tsx",
	type: "change",
} as FileDiffMetadata;

describe("normalizeSelectedLineRange", () => {
	it("keeps forward ranges unchanged", () => {
		const range: SelectedLineRange = {
			start: 10,
			end: 12,
			side: "additions",
		};

		expect(normalizeSelectedLineRange(range)).toEqual(range);
	});

	it("normalizes reverse ranges", () => {
		const range: SelectedLineRange = {
			start: 12,
			end: 10,
			side: "additions",
		};

		expect(normalizeSelectedLineRange(range)).toEqual({
			start: 10,
			end: 12,
			side: "additions",
		});
	});
});

describe("formatSelectedLineRange", () => {
	it("formats a single line range", () => {
		expect(
			formatSelectedLineRange({
				start: 18,
				end: 18,
				side: "additions",
			}),
		).toBe("additions 18");
	});

	it("formats a multi-line range on the same side", () => {
		expect(
			formatSelectedLineRange({
				start: 18,
				end: 22,
				side: "deletions",
			}),
		).toBe("deletions 18-22");
	});

	it("formats a cross-side range", () => {
		expect(
			formatSelectedLineRange({
				start: 18,
				end: 22,
				side: "deletions",
				endSide: "additions",
			}),
		).toBe("deletions 18 -> additions 22");
	});
});

describe("comment formatting helpers", () => {
	it("builds a location string", () => {
		expect(
			formatGitDiffCommentLocation(mockFile, {
				start: 24,
				end: 28,
				side: "additions",
			}),
		).toBe(
			"src/features/git/components/GitDiffPane.tsx:additions 24-28",
		);
	});

	it("builds a clipboard payload", () => {
		expect(
			formatGitDiffCommentPayload(
				mockFile,
				{
					start: 24,
					end: 28,
					side: "additions",
				},
				"  tighten spacing around comment actions  ",
			),
		).toBe(
			[
				"File: src/features/git/components/GitDiffPane.tsx",
				"Selection: additions 24-28",
				"Comment: tighten spacing around comment actions",
			].join("\n"),
		);
	});

	it("builds an annotation anchor from the normalized start", () => {
		expect(
			getGitDiffCommentAnchor({
				start: 40,
				end: 32,
				side: "deletions",
			}),
		).toEqual({
			lineNumber: 32,
			side: "deletions",
		});
	});
});
