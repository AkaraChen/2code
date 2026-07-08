import { describe, expect, it } from "vitest";
import {
	PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH,
	PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET,
	parseDiffFiles,
} from "./patchFiles";

const patch = `diff --git a/a.ts b/a.ts
index 587be6b..f9264f7 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-old
+new
+line
`;

function createPatch(id: string, lineCount = 1, lineSize = 24) {
	const body = Array.from(
		{ length: lineCount },
		(_, index) => `+${id}-${index}-${"x".repeat(lineSize)}`,
	).join("\n");
	return `diff --git a/${id}.txt b/${id}.txt
new file mode 100644
index 0000000..f9264f7
--- /dev/null
+++ b/${id}.txt
@@ -0,0 +1,${lineCount} @@
${body}
`;
}

function createPatchOverLength(id: string, targetLength: number) {
	const lineSize = 200;
	let lineCount = Math.ceil(targetLength / (lineSize + id.length + 16));
	let generatedPatch = createPatch(id, lineCount, lineSize);
	while (generatedPatch.length <= targetLength) {
		lineCount += 1;
		generatedPatch = createPatch(id, lineCount, lineSize);
	}
	return generatedPatch;
}

describe("parseDiffFiles", () => {
	it("reuses parsed file metadata for the same patch text", () => {
		const first = parseDiffFiles(patch);
		const second = parseDiffFiles(patch);

		expect(second).toBe(first);
		expect(first).toHaveLength(1);
	});

	it("does not cache diffs over the per-entry length limit", () => {
		const smallPatch = createPatch("small-before-large");
		const cachedSmall = parseDiffFiles(smallPatch);
		const largePatch = createPatchOverLength(
			"large-not-cached",
			PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH,
		);

		const firstLarge = parseDiffFiles(largePatch);
		const secondLarge = parseDiffFiles(largePatch);
		const smallAgain = parseDiffFiles(smallPatch);

		expect(largePatch.length).toBeGreaterThan(
			PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH,
		);
		expect(firstLarge).toEqual(secondLarge);
		expect(secondLarge).not.toBe(firstLarge);
		expect(smallAgain).toBe(cachedSmall);
	});

	it("evicts oldest cached diffs when the total length budget is exceeded", () => {
		const targetLength = Math.floor(PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH * 0.8);
		const oldestPatch = createPatchOverLength("budget-oldest", targetLength);
		const oldestFirst = parseDiffFiles(oldestPatch);
		const recentPatches = Array.from({ length: 10 }, (_, index) =>
			createPatchOverLength(`budget-recent-${index}`, targetLength)
		);

		for (const recentPatch of recentPatches) {
			parseDiffFiles(recentPatch);
		}

		const oldestSecond = parseDiffFiles(oldestPatch);
		const newestPatch = recentPatches[recentPatches.length - 1];
		const newestFirst = parseDiffFiles(newestPatch);
		const newestSecond = parseDiffFiles(newestPatch);

		expect(oldestPatch.length).toBeLessThanOrEqual(
			PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH,
		);
		expect(
			recentPatches.reduce((total, item) => total + item.length, oldestPatch.length),
		).toBeGreaterThan(PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET);
		expect(oldestSecond).not.toBe(oldestFirst);
		expect(newestSecond).toBe(newestFirst);
	});

	it("still enforces the entry-count limit for tiny diffs", () => {
		const tinyPatches = Array.from({ length: 21 }, (_, index) =>
			createPatch(`tiny-entry-limit-${index}`)
		);
		const first = parseDiffFiles(tinyPatches[0]);

		for (const tinyPatch of tinyPatches.slice(1)) {
			parseDiffFiles(tinyPatch);
		}

		const firstAgain = parseDiffFiles(tinyPatches[0]);
		const newestPatch = tinyPatches[tinyPatches.length - 1];
		const newestFirst = parseDiffFiles(newestPatch);
		const newestAgain = parseDiffFiles(newestPatch);

		expect(firstAgain).not.toBe(first);
		expect(newestAgain).toBe(newestFirst);
	});
});
