import { describe, expect, it } from "vitest";
import { getSupportedTopbarAppIds } from "./hooks";

describe("getSupportedTopbarAppIds", () => {
	it("keeps only launch app control ids in source order", () => {
		expect(
			getSupportedTopbarAppIds([
				{ id: "unknown" },
				{ id: "vscode" },
				{ id: "git-diff" },
				{ id: "cursor" },
			]),
		).toEqual(["vscode", "cursor"]);
	});
});
