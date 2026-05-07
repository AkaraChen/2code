import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UpdaterSettingsStore {
	acceptBetaUpdates: boolean;
	setAcceptBetaUpdates: (enabled: boolean) => void;
}

export const useUpdaterSettingsStore = create<UpdaterSettingsStore>()(
	persist(
		(set) => ({
			acceptBetaUpdates: false,
			setAcceptBetaUpdates: (enabled) =>
				set({ acceptBetaUpdates: enabled }),
		}),
		{ name: "updater-settings" },
	),
);
