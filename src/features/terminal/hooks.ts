import type { ITheme } from "@xterm/xterm";
import { use } from "react";
import { useSettingsStore } from "@/features/settings/stores";
import { ThemeContext } from "@/shared/providers/themeContext";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = use(ThemeContext);
	const darkThemeId = useSettingsStore((s) => s.darkTerminalTheme);
	const lightThemeId = useSettingsStore((s) => s.lightTerminalTheme);
	return isDark ? darkThemeId : lightThemeId;
}

export function useTerminalTheme(): ITheme {
	const id = useTerminalThemeId();
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
