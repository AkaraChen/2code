import type { StateCreator } from "zustand";
import type { SettingsStore } from "./index";

export interface NotificationSlice {
	notificationEnabled: boolean;
	notificationSound: string;
	setNotificationEnabled: (v: boolean) => void;
	setNotificationSound: (v: string) => void;
}

export const createNotificationSlice: StateCreator<
	SettingsStore,
	[["zustand/immer", never]],
	[],
	NotificationSlice
> = (set) => ({
	notificationEnabled: false,
	notificationSound: "Ping",
	setNotificationEnabled: (v) => set({ notificationEnabled: v }),
	setNotificationSound: (v) => set({ notificationSound: v }),
});
