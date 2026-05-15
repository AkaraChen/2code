import { describe, expect, it } from "vitest";
import { pathBasename } from "./path";

describe("pathBasename", () => {
	it("returns the final path segment", () => {
		expect(pathBasename("src/features/App.tsx")).toBe("App.tsx");
		expect(pathBasename("README.md")).toBe("README.md");
		expect(pathBasename("src/")).toBe("");
	});
});
