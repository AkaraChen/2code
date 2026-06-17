import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BorderRadius = "none" | "sm" | "md" | "lg" | "xl";

interface ThemeStore {
	borderRadius: BorderRadius;
	setBorderRadius: (radius: BorderRadius) => void;
}

export const BORDER_RADIUS_MAP: Record<
	BorderRadius,
	{ l1: string; l2: string; l3: string }
> = {
	none: { l1: "0", l2: "0", l3: "0" },
	sm: { l1: "4px", l2: "5px", l3: "6px" },
	md: { l1: "5px", l2: "6px", l3: "8px" },
	lg: { l1: "6px", l2: "8px", l3: "10px" },
	xl: { l1: "8px", l2: "10px", l3: "12px" },
};

export const useThemeStore = create<ThemeStore>()(
	persist(
		(set) => ({
			borderRadius: "sm",
			setBorderRadius: (radius) => set({ borderRadius: radius }),
		}),
		{ name: "theme-settings" },
	),
);

function syncBorderRadius(borderRadius: BorderRadius) {
	const radii = BORDER_RADIUS_MAP[borderRadius];
	const root = document.documentElement;
	root.style.setProperty("--chakra-radii-l1", radii.l1);
	root.style.setProperty("--chakra-radii-l2", radii.l2);
	root.style.setProperty("--chakra-radii-l3", radii.l3);
}

syncBorderRadius(useThemeStore.getState().borderRadius);

useThemeStore.subscribe((s, prev) => {
	if (s.borderRadius !== prev.borderRadius) syncBorderRadius(s.borderRadius);
});
