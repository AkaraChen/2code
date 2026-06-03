import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import {
	createReviewComment,
	formatReviewCommentsForAgent,
} from "./reviewQueue";

function makeFile(): FileDiffMetadata {
	return {
		name: "src/example.ts",
		additionLines: [
			"  const value = 1;  ",
			"",
			"    return value;",
		],
		deletionLines: [],
	} as unknown as FileDiffMetadata;
}

describe("reviewQueue formatting", () => {
	it("copies selected diff without extra prefix spaces or trailing whitespace", () => {
		const comment = createReviewComment(
			makeFile(),
			{ start: 1, end: 3, side: "additions" },
			"\n  tighten this up  \n\n",
		);

		expect(formatReviewCommentsForAgent([comment])).toContain(
			[
				"1. src/example.ts:1-3",
				"Selected diff:",
				"```diff",
				"+  const value = 1;",
				"+",
				"+    return value;",
				"```",
				"Comment:",
				"  tighten this up",
			].join("\n"),
		);
	});
});
