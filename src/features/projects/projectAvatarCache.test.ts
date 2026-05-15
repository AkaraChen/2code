import { describe, expect, it } from "vitest";
import { parseProjectAvatarCache } from "./projectAvatarCache";

describe("parseProjectAvatarCache", () => {
	it("keeps string and null avatar values", () => {
		expect(
			parseProjectAvatarCache({
				"project-1": "https://example.com/avatar.png",
				"project-2": null,
				"project-3": 42,
			}),
		).toEqual({
			"project-1": "https://example.com/avatar.png",
			"project-2": null,
		});
	});

	it("returns an empty cache for invalid shapes", () => {
		expect(parseProjectAvatarCache(["invalid"])).toEqual({});
		expect(parseProjectAvatarCache(null)).toEqual({});
	});
});
