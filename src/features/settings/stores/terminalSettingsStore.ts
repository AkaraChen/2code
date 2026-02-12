import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalThemeId } from "@/features/terminal/themes";

interface TerminalSettingsStore {
	fontFamily: string;
	fontSize: number;
	showAllFonts: boolean;
	darkTerminalTheme: TerminalThemeId;
	lightTerminalTheme: TerminalThemeId;
	syncTerminalTheme: boolean;
	setFontFamily: (family: string) => void;
	setFontSize: (size: number) => void;
	setShowAllFonts: (show: boolean) => void;
	setDarkTerminalTheme: (id: TerminalThemeId) => void;
	setLightTerminalTheme: (id: TerminalThemeId) => void;
	setSyncTerminalTheme: (sync: boolean) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
	persist(
		(set) => ({
			fontFamily: "JetBrains Mono",
			fontSize: 13,
			showAllFonts: false,
			darkTerminalTheme: "github-dark",
			lightTerminalTheme: "github-light",
			syncTerminalTheme: false,
			setFontFamily: (family) => set({ fontFamily: family }),
			setFontSize: (size) => set({ fontSize: size }),
			setShowAllFonts: (show) => set({ showAllFonts: show }),
			setDarkTerminalTheme: (id) => set({ darkTerminalTheme: id }),
			setLightTerminalTheme: (id) => set({ lightTerminalTheme: id }),
			setSyncTerminalTheme: (sync) => set({ syncTerminalTheme: sync }),
		}),
		{ name: "font-settings" },
	),
);
