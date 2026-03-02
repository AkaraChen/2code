import type { StateCreator } from "zustand";
import type { TabStore } from "../store";

export interface NotificationSlice {
	notifiedTabs: Set<string>;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
}

export const createNotificationSlice: StateCreator<
	TabStore,
	[["zustand/immer", never]],
	[],
	NotificationSlice
> = (set) => ({
	notifiedTabs: new Set<string>(),

	markNotified: (sessionId) =>
		set((state) => {
			state.notifiedTabs.add(sessionId);
		}),

	markRead: (sessionId) =>
		set((state) => {
			state.notifiedTabs.delete(sessionId);
		}),
});
