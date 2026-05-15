import { bench, describe } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import { collectPatchFiles } from "./patchFiles";

const patches = Array.from({ length: 500 }, (_, patchIndex) => ({
	files: Array.from(
		{ length: 6 },
		(_, fileIndex) =>
			({
				name: `src/patch-${patchIndex}/file-${fileIndex}.ts`,
				additionLines: [],
				deletionLines: [],
				hunks: [],
			}) as unknown as FileDiffMetadata,
	),
}));

function collectWithFlatMap() {
	return patches.flatMap((patch) => patch.files);
}

describe("parsed patch file collection", () => {
	bench("flatMap patch files", () => {
		collectWithFlatMap();
	});

	bench("preallocated patch files", () => {
		collectPatchFiles(patches);
	});
});
