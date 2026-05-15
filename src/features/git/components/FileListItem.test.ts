import { describe, expect, it } from "vitest";
import { splitDiffFilePath } from "./filePath";

describe("splitDiffFilePath", () => {
	it("splits basename and parent path", () => {
		expect(splitDiffFilePath("src/features/App.tsx")).toEqual({
			basename: "App.tsx",
			parentPath: "src/features",
		});
	});

	it("handles root-level paths", () => {
		expect(splitDiffFilePath("README.md")).toEqual({
			basename: "README.md",
			parentPath: null,
		});
	});
});
