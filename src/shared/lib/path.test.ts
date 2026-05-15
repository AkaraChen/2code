import { describe, expect, it } from "vitest";
import { getPathBasename } from "./path";

describe("getPathBasename", () => {
	it("returns the path segment after the last slash", () => {
		expect(getPathBasename("/repo/src/index.ts")).toBe("index.ts");
	});

	it("returns the original path when it has no slash", () => {
		expect(getPathBasename("index.ts")).toBe("index.ts");
	});

	it("matches split pop behavior for trailing slashes", () => {
		expect(getPathBasename("/repo/src/")).toBe("");
	});
});
