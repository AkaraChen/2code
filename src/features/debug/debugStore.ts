import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { startDebugLog, stopDebugLog } from "@/generated";
import type { LogEntry } from "@/generated/types";
import { useDebugLogStore } from "./debugLogStore";

interface DebugStore {
	enabled: boolean;
	panelOpen: boolean;
	setEnabled: (v: boolean) => void;
	setPanelOpen: (v: boolean) => void;
	togglePanel: () => void;
}

let activeChannel: Channel<LogEntry> | null = null;

function syncDebugChannel(enabled: boolean) {
	if (enabled && !activeChannel) {
		const channel = new Channel<LogEntry>();
		channel.onmessage = (entry) => {
			useDebugLogStore.getState().addLog(entry);
		};
		activeChannel = channel;
		startDebugLog({ onEvent: channel });
	} else if (!enabled && activeChannel) {
		stopDebugLog();
		activeChannel = null;
	}
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
		{
			name: "debug-settings",
			partialize: (s) => ({ enabled: s.enabled }),
			onRehydrateStorage: () => (state) => {
				if (state) syncDebugChannel(state.enabled);
			},
		},
	),
);

useDebugStore.subscribe((s, prev) => {
	if (s.enabled !== prev.enabled) syncDebugChannel(s.enabled);
});
