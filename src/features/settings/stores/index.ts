import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { tauriStorage } from "@/shared/lib/tauriStorage";
import { type AgentSlice, createAgentSlice } from "./agentSlice";
import {
	createNotificationSlice,
	type NotificationSlice,
} from "./notificationSlice";
import {
	createTerminalSlice,
	syncMonoFont,
	type TerminalSlice,
} from "./terminalSlice";
import {
	createThemeSlice,
	syncBorderRadius,
	type ThemeSlice,
} from "./themeSlice";

// Re-export types and constants for consumers
export type { AgentSlice } from "./agentSlice";
export type { NotificationSlice } from "./notificationSlice";
export type { TerminalSlice } from "./terminalSlice";
export type { AccentColor, BorderRadius, ThemeSlice } from "./themeSlice";
export { ACCENT_COLORS, BORDER_RADIUS_MAP } from "./themeSlice";

export type SettingsStore = AgentSlice &
	NotificationSlice &
	TerminalSlice &
	ThemeSlice;

export const useSettingsStore = create<SettingsStore>()(
	persist(
		immer((...a) => ({
			...createAgentSlice(...a),
			...createNotificationSlice(...a),
			...createTerminalSlice(...a),
			...createThemeSlice(...a),
		})),
		{
			name: "settings",
			version: 1,
			storage: createJSONStorage(() => tauriStorage),
		},
	),
);

// ── Side effects ────────────────────────────────────────────────────

// Sync on initial load
syncMonoFont(useSettingsStore.getState().fontFamily);
syncBorderRadius(useSettingsStore.getState().borderRadius);

// Sync on change
useSettingsStore.subscribe((s, prev) => {
	if (s.fontFamily !== prev.fontFamily) syncMonoFont(s.fontFamily);
	if (s.borderRadius !== prev.borderRadius) syncBorderRadius(s.borderRadius);
});
