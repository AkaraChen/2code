import { create } from "zustand";
import { setPerformanceProfileEnabled } from "./performanceProfile";

interface PerformanceProfileStore {
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
}

let syncQueue = Promise.resolve();

function syncPerformanceProfile(enabled: boolean) {
	syncQueue = syncQueue
		.then(() => setPerformanceProfileEnabled(enabled))
		.catch((error) => {
			console.error("Failed to sync performance profiling state", error);
		});
}

export const usePerformanceProfileStore = create<PerformanceProfileStore>()((set) => ({
	enabled: false,
	setEnabled: (enabled) => set({ enabled }),
}));

usePerformanceProfileStore.subscribe((state, prev) => {
	if (state.enabled !== prev.enabled) syncPerformanceProfile(state.enabled);
});
