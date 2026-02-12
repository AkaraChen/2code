import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DebugStore {
	enabled: boolean;
	panelOpen: boolean;
	setEnabled: (v: boolean) => void;
	setPanelOpen: (v: boolean) => void;
	togglePanel: () => void;
}

export const useDebugStore = create<DebugStore>()(
	persist(
		(set) => ({
			enabled: false,
			panelOpen: false,
			setEnabled: (v) => set({ enabled: v }),
			setPanelOpen: (v) => set({ panelOpen: v }),
			togglePanel: () =>
				set((s) => (s.enabled ? { panelOpen: !s.panelOpen } : s)),
		}),
		{ name: "debug-settings", partialize: (s) => ({ enabled: s.enabled }) },
	),
);
