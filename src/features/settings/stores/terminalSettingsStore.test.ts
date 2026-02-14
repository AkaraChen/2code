import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalSettingsStore } from "./terminalSettingsStore";

function resetStore() {
	useTerminalSettingsStore.setState({
		fontFamily: "JetBrains Mono",
		fontSize: 13,
		showAllFonts: false,
		darkTerminalTheme: "github-dark",
		lightTerminalTheme: "github-light",
		syncTerminalTheme: false,
	});
	localStorage.clear();
}

function getState() {
	return useTerminalSettingsStore.getState();
}

describe("useTerminalSettingsStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("fontFamily defaults to 'JetBrains Mono'", () => {
			expect(getState().fontFamily).toBe("JetBrains Mono");
		});

		it("fontSize defaults to 13", () => {
			expect(getState().fontSize).toBe(13);
		});

		it("showAllFonts defaults to false", () => {
			expect(getState().showAllFonts).toBe(false);
		});

		it("darkTerminalTheme defaults to 'github-dark'", () => {
			expect(getState().darkTerminalTheme).toBe("github-dark");
		});

		it("lightTerminalTheme defaults to 'github-light'", () => {
			expect(getState().lightTerminalTheme).toBe("github-light");
		});

		it("syncTerminalTheme defaults to false", () => {
			expect(getState().syncTerminalTheme).toBe(false);
		});
	});

	describe("setFontFamily", () => {
		it("updates fontFamily", () => {
			getState().setFontFamily("Fira Code");
			expect(getState().fontFamily).toBe("Fira Code");
		});

		it("syncs --chakra-fonts-mono CSS variable", () => {
			getState().setFontFamily("Fira Code");
			const val = document.documentElement.style.getPropertyValue(
				"--chakra-fonts-mono",
			);
			expect(val).toBe('"Fira Code", monospace');
		});
	});

	describe("setFontSize", () => {
		it("updates fontSize", () => {
			getState().setFontSize(16);
			expect(getState().fontSize).toBe(16);
		});

		it("does not trigger font CSS sync", () => {
			getState().setFontFamily("Test Font");
			const before = document.documentElement.style.getPropertyValue(
				"--chakra-fonts-mono",
			);
			getState().setFontSize(20);
			const after = document.documentElement.style.getPropertyValue(
				"--chakra-fonts-mono",
			);
			expect(after).toBe(before);
		});
	});

	describe("setShowAllFonts", () => {
		it("updates showAllFonts", () => {
			getState().setShowAllFonts(true);
			expect(getState().showAllFonts).toBe(true);
		});
	});

	describe("setDarkTerminalTheme", () => {
		it("updates darkTerminalTheme", () => {
			getState().setDarkTerminalTheme("dracula");
			expect(getState().darkTerminalTheme).toBe("dracula");
		});
	});

	describe("setLightTerminalTheme", () => {
		it("updates lightTerminalTheme", () => {
			getState().setLightTerminalTheme("one-light");
			expect(getState().lightTerminalTheme).toBe("one-light");
		});
	});

	describe("setSyncTerminalTheme", () => {
		it("updates syncTerminalTheme", () => {
			getState().setSyncTerminalTheme(true);
			expect(getState().syncTerminalTheme).toBe(true);
		});
	});

	describe("syncMonoFont (module-level side effect)", () => {
		it("sets --chakra-fonts-mono on initial load with default font", () => {
			const val = document.documentElement.style.getPropertyValue(
				"--chakra-fonts-mono",
			);
			expect(val).toBe('"JetBrains Mono", monospace');
		});
	});
});
