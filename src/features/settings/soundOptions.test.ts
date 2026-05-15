import { describe, expect, it } from "vitest";
import { buildSoundSelectItems } from "./soundOptions";

describe("buildSoundSelectItems", () => {
	it("prepends the none option", () => {
		expect(buildSoundSelectItems(["Glass", "Ping"], "None")).toEqual([
			{ value: "", label: "None" },
			{ value: "Glass", label: "Glass" },
			{ value: "Ping", label: "Ping" },
		]);
	});
});
