import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage } from "@/shared/lib/tauriStorage";

interface NotificationStore {
	enabled: boolean;
	sound: string;
	setEnabled: (v: boolean) => void;
	setSound: (v: string) => void;
}

type PersistedNotificationSettings = Pick<
	NotificationStore,
	"enabled" | "sound"
>;

function migrateNotificationSettings(
	persistedState: unknown,
): PersistedNotificationSettings {
	return persistedState as PersistedNotificationSettings;
}

export const useNotificationStore = create<NotificationStore>()(
	persist<NotificationStore, [], [], PersistedNotificationSettings>(
		(set) => ({
			enabled: false,
			sound: "Ping",
			setEnabled: (v) => set({ enabled: v }),
			setSound: (v) => set({ sound: v }),
		}),
		{
			name: "notification-settings",
			storage: createJSONStorage(() => tauriStorage),
			version: 1,
			migrate: migrateNotificationSettings,
		},
	),
);
