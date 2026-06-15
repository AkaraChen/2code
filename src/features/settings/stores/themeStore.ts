import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BorderRadius = "none" | "sm" | "md" | "lg" | "xl";
type WindowOpacity = number;

interface ThemeStore {
	borderRadius: BorderRadius;
	windowOpacity: WindowOpacity;
	setBorderRadius: (radius: BorderRadius) => void;
	setWindowOpacity: (opacity: WindowOpacity) => void;
}

interface ThemePersistedState {
	borderRadius?: unknown;
	windowOpacity?: unknown;
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

const BORDER_RADIUS_VALUES = [
	"none",
	"sm",
	"md",
	"lg",
	"xl",
] as const;

function normalizeBorderRadius(value: unknown): BorderRadius {
	return BORDER_RADIUS_VALUES.includes(value as BorderRadius)
		? (value as BorderRadius)
		: "sm";
}

function normalizeWindowOpacity(value: unknown): WindowOpacity {
	if (typeof value !== "number" || !Number.isFinite(value)) return 100;

	return Math.min(100, Math.max(0, Math.round(value)));
}

export function migrateThemePersistedState(
	persistedState: unknown,
): Pick<ThemeStore, "borderRadius" | "windowOpacity"> {
	const state =
		persistedState && typeof persistedState === "object"
			? (persistedState as ThemePersistedState)
			: {};

	return {
		borderRadius: normalizeBorderRadius(state.borderRadius),
		windowOpacity: normalizeWindowOpacity(state.windowOpacity),
	};
}

export const useThemeStore = create<ThemeStore>()(
	persist(
		(set) => ({
			borderRadius: "sm",
			windowOpacity: 100,
			setBorderRadius: (radius) => set({ borderRadius: radius }),
			setWindowOpacity: (opacity) =>
				set({ windowOpacity: normalizeWindowOpacity(opacity) }),
		}),
		{
			name: "theme-settings",
			version: 1,
			migrate: (persistedState) =>
				migrateThemePersistedState(persistedState),
		},
	),
);

function syncBorderRadius(borderRadius: BorderRadius) {
	const radii = BORDER_RADIUS_MAP[borderRadius];
	const root = document.documentElement;
	root.style.setProperty("--chakra-radii-l1", radii.l1);
	root.style.setProperty("--chakra-radii-l2", radii.l2);
	root.style.setProperty("--chakra-radii-l3", radii.l3);
}

function syncWindowOpacity(windowOpacity: WindowOpacity) {
	document.documentElement.style.setProperty(
		"--app-window-bg-alpha",
		String(windowOpacity / 100),
	);
}

syncBorderRadius(useThemeStore.getState().borderRadius);
syncWindowOpacity(useThemeStore.getState().windowOpacity);

useThemeStore.subscribe((s, prev) => {
	if (s.borderRadius !== prev.borderRadius) syncBorderRadius(s.borderRadius);
	if (s.windowOpacity !== prev.windowOpacity)
		syncWindowOpacity(s.windowOpacity);
});
