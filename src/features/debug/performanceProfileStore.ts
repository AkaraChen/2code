import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage } from "@/shared/lib/tauriStorage";
import { setPerformanceProfileEnabled } from "./performanceProfile";

interface PerformanceProfileStore {
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
}

function syncPerformanceProfile(enabled: boolean) {
	void setPerformanceProfileEnabled(enabled);
}

export const usePerformanceProfileStore = create<PerformanceProfileStore>()(
	persist(
		(set) => ({
			enabled: false,
			setEnabled: (enabled) => set({ enabled }),
		}),
		{
			name: "performance-profile-settings",
			storage: createJSONStorage(() => tauriStorage),
			onRehydrateStorage: () => (state) => {
				if (state?.enabled) syncPerformanceProfile(true);
			},
		},
	),
);

usePerformanceProfileStore.subscribe((state, prev) => {
	if (state.enabled !== prev.enabled) syncPerformanceProfile(state.enabled);
});
