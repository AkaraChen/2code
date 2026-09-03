import { describe, expect, it } from "vitest";
import { toFileTreeGitStatus } from "./fileTreeGitStatus";

describe("toFileTreeGitStatus", () => {
	it("keeps valid status entries and drops invalid entries", () => {
		expect(
			toFileTreeGitStatus([
				{ path: "src/added.ts", status: "added" },
				{ path: "src/deleted.ts", status: "deleted" },
				{ path: "target/", status: "ignored" },
				{ path: "src/modified.ts", status: "modified" },
				{ path: "src/renamed.ts", status: "renamed" },
				{ path: "src/untracked.ts", status: "untracked" },
				{ path: "", status: "added" },
				{ path: "src/ignored.ts", status: "unknown" },
			]),
		).toEqual([
			{ path: "src/added.ts", status: "added" },
			{ path: "src/deleted.ts", status: "deleted" },
			{ path: "target/", status: "ignored" },
			{ path: "src/modified.ts", status: "modified" },
			{ path: "src/renamed.ts", status: "renamed" },
			{ path: "src/untracked.ts", status: "untracked" },
		]);
	});

	it("returns an empty list when entries are missing", () => {
		expect(toFileTreeGitStatus(undefined)).toEqual([]);
	});
});
