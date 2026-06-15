import { describe, expect, it } from "vitest";
import {
	terminalThemeIds,
	terminalThemeNames,
	terminalThemes,
	withTerminalBackgroundAlpha,
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

	it("provides a label and full xterm color palette for every theme id", () => {
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

	it("applies opacity to terminal background without changing palette colors", () => {
		const theme = withTerminalBackgroundAlpha(
			terminalThemes["github-dark"],
			40,
		);

		expect(theme.background).toBe("rgba(22, 22, 22, 0.4)");
		expect(theme.foreground).toBe(terminalThemes["github-dark"].foreground);
		expect(theme.green).toBe(terminalThemes["github-dark"].green);
	});

	it("keeps terminal background unchanged at full opacity", () => {
		const theme = withTerminalBackgroundAlpha(
			terminalThemes["github-dark"],
			100,
		);

		expect(theme.background).toBe("#161616");
	});

	it("parses css color backgrounds before applying opacity", () => {
		const theme = withTerminalBackgroundAlpha(
			{
				background: "rgb(40, 42, 54)",
				foreground: "#f8f8f2",
			},
			20,
		);

		expect(theme.background).toBe("rgba(40, 42, 54, 0.2)");
	});
});
