import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NotificationStore {
	enabled: boolean;
	sound: string;
	setEnabled: (v: boolean) => void;
	setSound: (v: string) => void;
}

export const useNotificationStore = create<NotificationStore>()(
	persist(
		(set) => ({
			enabled: false,
			sound: "Ping",
			setEnabled: (v) => set({ enabled: v }),
			setSound: (v) => set({ sound: v }),
		}),
		{ name: "notification-settings" },
	),
);
