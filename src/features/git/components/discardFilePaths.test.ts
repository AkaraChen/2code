import { describe, expect, it } from "vitest";
import { buildDiscardFilePaths } from "./discardFilePaths";

function resolvePath(worktreePath: string, relativePath: string) {
	return `${worktreePath}/${relativePath}`;
}

describe("buildDiscardFilePaths", () => {
	it("returns current and previous paths for renamed files", () => {
		expect(
			buildDiscardFilePaths(
				{ name: "src/new.ts", prevName: "src/old.ts" },
				"/repo",
				resolvePath,
			),
		).toEqual({
			relativePaths: ["src/new.ts", "src/old.ts"],
			filePathsToRefresh: ["/repo/src/new.ts", "/repo/src/old.ts"],
		});
	});

	it("deduplicates unchanged previous paths", () => {
		expect(
			buildDiscardFilePaths(
				{ name: "src/file.ts", prevName: "src/file.ts" },
				"/repo",
				resolvePath,
			),
		).toEqual({
			relativePaths: ["src/file.ts"],
			filePathsToRefresh: ["/repo/src/file.ts"],
		});
	});

	it("ignores empty previous paths", () => {
		expect(
			buildDiscardFilePaths(
				{ name: "src/file.ts", prevName: undefined },
				"/repo",
				resolvePath,
			),
		).toEqual({
			relativePaths: ["src/file.ts"],
			filePathsToRefresh: ["/repo/src/file.ts"],
		});
	});
});
