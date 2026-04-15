import { create } from "zustand";
import { persist } from "zustand/middleware";

export const APP_SIDEBAR_MIN_WIDTH = 220;
export const APP_SIDEBAR_MAX_WIDTH = 420;
export const APP_SIDEBAR_DEFAULT_WIDTH = 250;

export function clampAppSidebarWidth(width: number) {
	return Math.min(
		APP_SIDEBAR_MAX_WIDTH,
		Math.max(APP_SIDEBAR_MIN_WIDTH, width),
	);
}

interface AppSidebarStore {
	width: number;
	setWidth: (width: number) => void;
}

export const useAppSidebarStore = create<AppSidebarStore>()(
	persist(
		(set) => ({
			width: APP_SIDEBAR_DEFAULT_WIDTH,
			setWidth: (width) => set({ width: clampAppSidebarWidth(width) }),
		}),
		{
			name: "app-sidebar-width",
			version: 1,
			partialize: (state) => ({ width: state.width }),
		},
	),
);

function syncSidebarWidth(width: number) {
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--sidebar-width",
		`${clampAppSidebarWidth(width)}px`,
	);
}

syncSidebarWidth(useAppSidebarStore.getState().width);

useAppSidebarStore.subscribe((state, prevState) => {
	if (state.width !== prevState.width) {
		syncSidebarWidth(state.width);
	}
});
