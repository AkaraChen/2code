import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FontStore {
	fontFamily: string;
	showAllFonts: boolean;
	setFontFamily: (family: string) => void;
	setShowAllFonts: (show: boolean) => void;
}

export const useFontStore = create<FontStore>()(
	persist(
		(set) => ({
			fontFamily: "JetBrains Mono",
			showAllFonts: false,
			setFontFamily: (family) => set({ fontFamily: family }),
			setShowAllFonts: (show) => set({ showAllFonts: show }),
		}),
		{ name: "font-settings" },
	),
);
