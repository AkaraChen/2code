import { describe, expect, it } from "vitest";
import { getFileNameParts } from "./FileListItem";

describe("getFileNameParts", () => {
	it("returns the full file name when there is no parent path", () => {
		expect(getFileNameParts("README.md")).toEqual({
			basename: "README.md",
			parentPath: null,
		});
	});

	it("splits nested paths into parent path and basename", () => {
		expect(getFileNameParts("src/features/git/utils.ts")).toEqual({
			basename: "utils.ts",
			parentPath: "src/features/git",
		});
	});
});
