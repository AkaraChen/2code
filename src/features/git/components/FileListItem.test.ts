import { describe, expect, it } from "vitest";
import { getFileDisplayParts } from "../utils";

describe("getFileDisplayParts", () => {
	it("splits git file names into basename and parent path", () => {
		expect(getFileDisplayParts("src/features/git/FileListItem.tsx")).toEqual(
			{
				basename: "FileListItem.tsx",
				parentPath: "src/features/git",
			},
		);
		expect(getFileDisplayParts("README.md")).toEqual({
			basename: "README.md",
			parentPath: null,
		});
	});
});
