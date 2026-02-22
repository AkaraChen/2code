import type { ITheme } from "@xterm/xterm";
import { use } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { ThemeContext } from "@/shared/providers/themeContext";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = use(ThemeContext);
	return useTerminalSettingsStore((s) => {
		if (s.syncTerminalTheme) return isDark ? s.darkTerminalTheme : s.lightTerminalTheme;
		return s.darkTerminalTheme;
	});
}

export function useTerminalTheme(): ITheme {
	const id = useTerminalThemeId();
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
