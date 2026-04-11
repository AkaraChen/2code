import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TerminalThemeId } from "@/features/terminal/themes";

export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 20;

interface TerminalSettingsStore {
	fontFamily: string;
	fontSize: number;
	showAllFonts: boolean;
	darkTerminalTheme: TerminalThemeId;
	lightTerminalTheme: TerminalThemeId;
	syncTerminalTheme: boolean;
	setFontFamily: (family: string) => void;
	setFontSize: (size: number) => void;
	increaseFontSize: () => void;
	decreaseFontSize: () => void;
	setShowAllFonts: (show: boolean) => void;
	setDarkTerminalTheme: (id: TerminalThemeId) => void;
	setLightTerminalTheme: (id: TerminalThemeId) => void;
	setSyncTerminalTheme: (sync: boolean) => void;
}

function clampTerminalFontSize(size: number) {
	if (!Number.isFinite(size)) return DEFAULT_TERMINAL_FONT_SIZE;
	return Math.min(
		MAX_TERMINAL_FONT_SIZE,
		Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)),
	);
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
	persist(
		(set) => ({
			fontFamily: "JetBrains Mono",
			fontSize: DEFAULT_TERMINAL_FONT_SIZE,
			showAllFonts: false,
			darkTerminalTheme: "github-dark",
			lightTerminalTheme: "github-light",
			syncTerminalTheme: false,
			setFontFamily: (family) => set({ fontFamily: family }),
			setFontSize: (size) =>
				set({ fontSize: clampTerminalFontSize(size) }),
			increaseFontSize: () =>
				set((state) => ({
					fontSize: clampTerminalFontSize(state.fontSize + 1),
				})),
			decreaseFontSize: () =>
				set((state) => ({
					fontSize: clampTerminalFontSize(state.fontSize - 1),
				})),
			setShowAllFonts: (show) => set({ showAllFonts: show }),
			setDarkTerminalTheme: (id) => set({ darkTerminalTheme: id }),
			setLightTerminalTheme: (id) => set({ lightTerminalTheme: id }),
			setSyncTerminalTheme: (sync) => set({ syncTerminalTheme: sync }),
		}),
		{ name: "font-settings" },
	),
);

function syncMonoFont(fontFamily: string) {
	document.documentElement.style.setProperty(
		"--chakra-fonts-mono",
		`"${fontFamily}", monospace`,
	);
}

syncMonoFont(useTerminalSettingsStore.getState().fontFamily);

useTerminalSettingsStore.subscribe((s, prev) => {
	if (s.fontFamily !== prev.fontFamily) syncMonoFont(s.fontFamily);
});
