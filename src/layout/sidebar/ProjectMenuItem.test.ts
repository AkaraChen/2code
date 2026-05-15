import { describe, expect, it } from "vitest";
import { splitDefaultProfile } from "./ProjectMenuItem";

describe("splitDefaultProfile", () => {
	it("returns the default profile and preserves non-default order", () => {
		const defaultProfile = { id: "default", is_default: true };
		const profiles = [
			{ id: "one", is_default: false },
			defaultProfile,
			{ id: "two", is_default: false },
		];

		expect(splitDefaultProfile(profiles)).toEqual({
			defaultProfile,
			nonDefaultProfiles: [
				{ id: "one", is_default: false },
				{ id: "two", is_default: false },
			],
		});
	});
});
