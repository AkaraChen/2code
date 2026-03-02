import type { StateCreator } from "zustand";
import type { SettingsStore } from "./index";

export type AccentColor =
	| "gray"
	| "red"
	| "orange"
	| "yellow"
	| "green"
	| "teal"
	| "blue"
	| "cyan"
	| "purple"
	| "pink";

export type BorderRadius = "none" | "sm" | "md" | "lg" | "xl";

export const ACCENT_COLORS: AccentColor[] = [
	"gray",
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"cyan",
	"purple",
	"pink",
];

export const BORDER_RADIUS_MAP: Record<
	BorderRadius,
	{ l1: string; l2: string; l3: string }
> = {
	none: { l1: "0", l2: "0", l3: "0" },
	sm: { l1: "0.125rem", l2: "0.25rem", l3: "0.375rem" },
	md: { l1: "0.25rem", l2: "0.375rem", l3: "0.5rem" },
	lg: { l1: "0.5rem", l2: "0.75rem", l3: "1rem" },
	xl: { l1: "0.75rem", l2: "1rem", l3: "1.5rem" },
};

export interface ThemeSlice {
	accentColor: AccentColor;
	borderRadius: BorderRadius;
	setAccentColor: (color: AccentColor) => void;
	setBorderRadius: (radius: BorderRadius) => void;
}

export const createThemeSlice: StateCreator<
	SettingsStore,
	[["zustand/immer", never]],
	[],
	ThemeSlice
> = (set) => ({
	accentColor: "blue",
	borderRadius: "sm",
	setAccentColor: (color) => set({ accentColor: color }),
	setBorderRadius: (radius) => set({ borderRadius: radius }),
});

export function syncBorderRadius(borderRadius: string) {
	const radii = BORDER_RADIUS_MAP[borderRadius as keyof typeof BORDER_RADIUS_MAP];
	if (!radii) return;
	const root = document.documentElement;
	root.style.setProperty("--chakra-radii-l1", radii.l1);
	root.style.setProperty("--chakra-radii-l2", radii.l2);
	root.style.setProperty("--chakra-radii-l3", radii.l3);
}
