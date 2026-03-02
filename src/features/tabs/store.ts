import { listen } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import {
	createNotificationSlice,
	type NotificationSlice,
} from "./stores/notificationSlice";
import { createPaneSlice, type PaneSlice } from "./stores/paneSlice";
import { createProfileSlice, type ProfileSlice } from "./stores/profileSlice";
import { createTabSlice, type TabSlice } from "./stores/tabSlice";

enableMapSet();

export type TabStore = ProfileSlice & TabSlice & PaneSlice & NotificationSlice;

export const useTabStore = create<TabStore>()(
	persist(
		immer((...a) => ({
			...createProfileSlice(...a),
			...createTabSlice(...a),
			...createPaneSlice(...a),
			...createNotificationSlice(...a),
		})),
		{
			name: "tab-layout",
			version: 1,
			// Only persist the tab layout (profiles). notifiedTabs is ephemeral.
			partialize: (state) => ({ profiles: state.profiles }),
		},
	),
);

/** IDs of profiles that currently have tabs open. */
export function useTabProfileIds() {
	return useTabStore(useShallow((s) => Object.keys(s.profiles)));
}

/** Whether a profile has any tab with an unread notification. */
export function useProfileHasNotification(profileId: string): boolean {
	return useTabStore((s) => {
		const profile = s.profiles[profileId];
		if (!profile) return false;
		return profile.tabs.some((t) => {
			if (t.type === "terminal") {
				return t.panes.some((p) => s.notifiedTabs.has(p.sessionId));
			}
			// Agent sessions don't emit pty-notify, so never in notifiedTabs
			return false;
		});
	});
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTabStore.getState().markNotified(event.payload);
});
