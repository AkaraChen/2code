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
	sm: { l1: "0", l2: "0", l3: "0" },
	md: { l1: "0", l2: "0", l3: "0" },
	lg: { l1: "0", l2: "0", l3: "0" },
	xl: { l1: "0", l2: "0", l3: "0" },
};

export const useThemeStore = create<ThemeStore>()(
	persist(
		(set) => ({
			borderRadius: "none",
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
