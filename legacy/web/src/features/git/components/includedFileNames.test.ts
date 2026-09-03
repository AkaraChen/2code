import { describe, expect, it } from "vitest";
import { collectOrderedIncludedFileNames } from "./includedFileNames";

describe("collectOrderedIncludedFileNames", () => {
	it("keeps included names in file order", () => {
		expect(
			collectOrderedIncludedFileNames(
				[{ name: "a.ts" }, { name: "b.ts" }, { name: "c.ts" }],
				new Set(["c.ts", "a.ts"]),
			),
		).toEqual(["a.ts", "c.ts"]);
	});

	it("returns an empty list when no files are included", () => {
		expect(
			collectOrderedIncludedFileNames(
				[{ name: "a.ts" }, { name: "b.ts" }],
				new Set(),
			),
		).toEqual([]);
	});

	it("ignores included names that are not in the file list", () => {
		expect(
			collectOrderedIncludedFileNames(
				[{ name: "a.ts" }, { name: "b.ts" }],
				new Set(["missing.ts", "b.ts"]),
			),
		).toEqual(["b.ts"]);
	});
});
