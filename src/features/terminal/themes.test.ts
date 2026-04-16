import { describe, expect, it } from "vitest";
import {
	terminalThemeIds,
	terminalThemeNames,
	terminalThemes,
} from "./themes";

const requiredThemeKeys = [
	"background",
	"foreground",
	"cursor",
	"selectionBackground",
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;

describe("terminalThemes", () => {
	it("keeps the theme id list in sync with the display names", () => {
		expect(terminalThemeIds).toEqual(Object.keys(terminalThemeNames));
	});

	it("provides a label and full terminal color palette for every theme id", () => {
		for (const id of terminalThemeIds) {
			expect(terminalThemeNames[id]).toBeTruthy();
			for (const key of requiredThemeKeys) {
				expect(terminalThemes[id][key]).toMatch(/^#/);
			}
		}
	});

	it("uses distinct background colors for dark and light GitHub themes", () => {
		expect(terminalThemes["github-dark"].background).not.toBe(
			terminalThemes["github-light"].background,
		);
		expect(terminalThemes["github-dark"].background).toBe("#161616");
		expect(terminalThemes["github-light"].background).toBe("#ffffff");
	});
});
