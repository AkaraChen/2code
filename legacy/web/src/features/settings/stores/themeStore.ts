import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BorderRadius = "none" | "sm" | "md" | "lg" | "xl";

interface ThemeStore {
	borderRadius: BorderRadius;
	setBorderRadius: (radius: BorderRadius) => void;
}

type PersistedThemeSettings = Pick<ThemeStore, "borderRadius">;

function migrateThemeSettings(persistedState: unknown): PersistedThemeSettings {
	return persistedState as PersistedThemeSettings;
}

export const BORDER_RADIUS_MAP: Record<
	BorderRadius,
	{ sm: string; md: string; lg: string; xl: string }
> = {
	none: { sm: "0", md: "0", lg: "0", xl: "0" },
	sm: { sm: "4px", md: "5px", lg: "6px", xl: "8px" },
	md: { sm: "5px", md: "6px", lg: "8px", xl: "10px" },
	lg: { sm: "6px", md: "8px", lg: "10px", xl: "12px" },
	xl: { sm: "8px", md: "10px", lg: "12px", xl: "14px" },
};

export const useThemeStore = create<ThemeStore>()(
	persist<ThemeStore, [], [], PersistedThemeSettings>(
		(set) => ({
			borderRadius: "sm",
			setBorderRadius: (radius) => set({ borderRadius: radius }),
		}),
		{
			name: "theme-settings",
			version: 1,
			migrate: migrateThemeSettings,
		},
	),
);

function syncBorderRadius(borderRadius: BorderRadius) {
	const radii = BORDER_RADIUS_MAP[borderRadius];
	const root = document.documentElement;
	root.style.setProperty("--radius", radii.lg);
	root.style.setProperty("--radius-sm", radii.sm);
	root.style.setProperty("--radius-md", radii.md);
	root.style.setProperty("--radius-lg", radii.lg);
	root.style.setProperty("--radius-xl", radii.xl);
}

syncBorderRadius(useThemeStore.getState().borderRadius);

useThemeStore.subscribe((s, prev) => {
	if (s.borderRadius !== prev.borderRadius) syncBorderRadius(s.borderRadius);
});
