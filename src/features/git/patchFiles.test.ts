import { describe, expect, it } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import { collectPatchFiles } from "./patchFiles";

const fileA = { name: "a.ts" } as FileDiffMetadata;
const fileB = { name: "b.ts" } as FileDiffMetadata;

describe("collectPatchFiles", () => {
	it("flattens patch files in order", () => {
		expect(
			collectPatchFiles([
				{ files: [fileA] },
				{ files: [] },
				{ files: [fileB] },
			]),
		).toEqual([fileA, fileB]);
	});
});
