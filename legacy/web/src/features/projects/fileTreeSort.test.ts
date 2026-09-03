import { describe, expect, it } from "vitest";
import { compareFileTreePaths } from "./fileTreeSort";

describe("compareFileTreePaths", () => {
	it("sorts paths case-insensitively", () => {
		expect(["src/b.ts", "src/A.ts", "README.md"].sort(compareFileTreePaths))
			.toEqual(["README.md", "src/A.ts", "src/b.ts"]);
	});
});
