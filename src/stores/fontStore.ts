import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FontStore {
	fontFamily: string;
	fontSize: number;
	showAllFonts: boolean;
	setFontFamily: (family: string) => void;
	setFontSize: (size: number) => void;
	setShowAllFonts: (show: boolean) => void;
}

export const useFontStore = create<FontStore>()(
	persist(
		(set) => ({
			fontFamily: "JetBrains Mono",
			fontSize: 13,
			showAllFonts: false,
			setFontFamily: (family) => set({ fontFamily: family }),
			setFontSize: (size) => set({ fontSize: size }),
			setShowAllFonts: (show) => set({ showAllFonts: show }),
		}),
		{ name: "font-settings" },
	),
);
