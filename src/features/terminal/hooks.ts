import type { ITheme } from "@xterm/xterm";
import { use } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { ThemeContext } from "@/shared/providers/themeContext";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

// Re-export unified tab hooks as terminal-specific aliases
export {
	useCloseTab as useCloseTerminalTab,
	useCreateTab as useCreateTerminalTab,
} from "@/features/tabs/hooks";

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = use(ThemeContext);
	const darkTerminalTheme = useTerminalSettingsStore(
		(s) => s.darkTerminalTheme,
	);
	const lightTerminalTheme = useTerminalSettingsStore(
		(s) => s.lightTerminalTheme,
	);
	const syncTerminalTheme = useTerminalSettingsStore(
		(s) => s.syncTerminalTheme,
	);

	if (syncTerminalTheme) return darkTerminalTheme;
	return isDark ? darkTerminalTheme : lightTerminalTheme;
}

export function useTerminalTheme(): ITheme {
	const id = useTerminalThemeId();
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
