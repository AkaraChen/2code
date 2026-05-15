import { describe, expect, it } from "vitest";
import { getProjectAvatarFallback } from "./ProjectAvatar";

describe("getProjectAvatarFallback", () => {
	it("uses the first visible character", () => {
		expect(getProjectAvatarFallback("  code  ")).toBe("C");
	});

	it("falls back for blank names", () => {
		expect(getProjectAvatarFallback("   ")).toBe("?");
	});

	it("preserves first-codepoint behavior for emoji names", () => {
		expect(getProjectAvatarFallback("🚀 Launch")).toBe("🚀");
	});
});
