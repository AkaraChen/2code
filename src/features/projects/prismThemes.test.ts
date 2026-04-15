import { describe, expect, it } from "vitest";
import { terminalThemeIds } from "@/features/terminal/themes";
import { getPrismTheme } from "./prismThemes";

const requiredSelectors = [
	"comment",
	"punctuation",
	"keyword",
	"function",
	"class-name",
	"tag",
	"attr-name",
	"attr-value",
	"string",
	"number",
	"property",
	"variable",
	"operator",
	"regex",
	"important",
	"template-string",
	"property-access",
	"tag.attr-value.punctuation.attr-equals",
] as const;

function hasFontFamily(theme: Record<string, Record<string, unknown>>) {
	return Object.values(theme).some(
		(style) => "fontFamily" in style || "font-family" in style,
	);
}

describe("prismThemes", () => {
	it("provides a style object for every terminal theme", () => {
		for (const themeId of terminalThemeIds) {
			expect(getPrismTheme(themeId)).toBeTruthy();
			expect(getPrismTheme(themeId)).toHaveProperty('code[class*="language-"]');
			expect(getPrismTheme(themeId)).toHaveProperty('pre[class*="language-"]');
			expect(Object.keys(getPrismTheme(themeId)).length).toBeGreaterThanOrEqual(35);
		}
	});

	it("removes theme-level font-family overrides", () => {
		for (const themeId of terminalThemeIds) {
			expect(
				hasFontFamily(
					getPrismTheme(themeId) as Record<string, Record<string, unknown>>,
				),
			).toBe(false);
		}
	});

	it("covers the main Prism token selectors we rely on in file viewer", () => {
		for (const themeId of terminalThemeIds) {
			const theme = getPrismTheme(themeId);
			for (const selector of requiredSelectors) {
				expect(theme).toHaveProperty(selector);
			}
		}
	});
});
