import { describe, expect, it } from "vitest";
import { buildFilePathSet } from "./fileTreePathSets";

describe("buildFilePathSet", () => {
	it("keeps only non-directory paths", () => {
		const filePathSet = buildFilePathSet(
			new Set(["src/", "src/main.ts", "README.md"]),
		);

		expect([...filePathSet]).toEqual(["src/main.ts", "README.md"]);
	});
});
