import { syncStoreAcrossWindows } from "@/shared/lib/broadcastStoreSync";
import { useNotificationStore } from "./notificationStore";
import { useSidebarSettingsStore } from "./sidebarSettingsStore";
import { useTerminalSettingsStore } from "./terminalSettingsStore";
import { useTerminalTemplatesStore } from "./terminalTemplatesStore";
import { useThemeStore } from "./themeStore";
import { useWorktreeSettingsStore } from "./worktreeSettingsStore";

// Settings are edited in the settings window but consumed in the main
// window (terminal font, themes, notifications, ...). Each webview has
// its own store instances, so changes must be broadcast to apply live
// in both windows. Channel names mirror the persist storage keys.
syncStoreAcrossWindows(useTerminalSettingsStore, "sync:font-settings");
syncStoreAcrossWindows(useThemeStore, "sync:theme-settings");
syncStoreAcrossWindows(useNotificationStore, "sync:notification-settings");
syncStoreAcrossWindows(useSidebarSettingsStore, "sync:sidebar-settings");
syncStoreAcrossWindows(useWorktreeSettingsStore, "sync:worktree-settings");
syncStoreAcrossWindows(
	useTerminalTemplatesStore,
	"sync:terminal-template-settings",
);
