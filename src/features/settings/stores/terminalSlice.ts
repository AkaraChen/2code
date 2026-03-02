import type { StateCreator } from "zustand";
import type { TerminalThemeId } from "@/features/terminal/themes";
import type { SettingsStore } from "./index";

export interface TerminalSlice {
	fontFamily: string;
	fontSize: number;
	showAllFonts: boolean;
	darkTerminalTheme: TerminalThemeId;
	lightTerminalTheme: TerminalThemeId;
	setFontFamily: (family: string) => void;
	setFontSize: (size: number) => void;
	setShowAllFonts: (show: boolean) => void;
	setDarkTerminalTheme: (id: TerminalThemeId) => void;
	setLightTerminalTheme: (id: TerminalThemeId) => void;
}

export const createTerminalSlice: StateCreator<
	SettingsStore,
	[["zustand/immer", never]],
	[],
	TerminalSlice
> = (set) => ({
	fontFamily: "JetBrains Mono",
	fontSize: 13,
	showAllFonts: false,
	darkTerminalTheme: "github-dark",
	lightTerminalTheme: "github-light",
	setFontFamily: (family) => set({ fontFamily: family }),
	setFontSize: (size) => set({ fontSize: size }),
	setShowAllFonts: (show) => set({ showAllFonts: show }),
	setDarkTerminalTheme: (id) => set({ darkTerminalTheme: id }),
	setLightTerminalTheme: (id) => set({ lightTerminalTheme: id }),
});

export function syncMonoFont(fontFamily: string) {
	document.documentElement.style.setProperty(
		"--chakra-fonts-mono",
		`"${fontFamily}", monospace`,
	);
}
