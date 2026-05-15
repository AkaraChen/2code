import { describe, expect, it } from "vitest";
import { collectChangeFileNames } from "./changeFileNames";

describe("collectChangeFileNames", () => {
	it("returns ordered names and a matching set", () => {
		const result = collectChangeFileNames([
			{ name: "a.ts" },
			{ name: "b.ts" },
		]);

		expect(result.names).toEqual(["a.ts", "b.ts"]);
		expect(result.nameSet).toEqual(new Set(["a.ts", "b.ts"]));
	});
});
