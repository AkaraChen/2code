import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarSettingsStore {
	showProjectAvatars: boolean;
	setShowProjectAvatars: (enabled: boolean) => void;
}

export const useSidebarSettingsStore = create<SidebarSettingsStore>()(
	persist(
		(set) => ({
			showProjectAvatars: true,
			setShowProjectAvatars: (enabled) =>
				set({ showProjectAvatars: enabled }),
		}),
		{ name: "sidebar-settings" },
	),
);
