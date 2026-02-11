import type { ITheme } from "@xterm/xterm";
import { useThemePreference } from "@/components/ThemeProvider";
import { terminalThemes } from "@/lib/terminalThemes";
import { useFontStore } from "@/stores/fontStore";

export function useTerminalTheme(): ITheme {
	const { isDark } = useThemePreference();
	const darkTerminalTheme = useFontStore((s) => s.darkTerminalTheme);
	const lightTerminalTheme = useFontStore((s) => s.lightTerminalTheme);
	const syncTerminalTheme = useFontStore((s) => s.syncTerminalTheme);

	if (syncTerminalTheme) {
		return (
			terminalThemes[darkTerminalTheme] ?? terminalThemes["github-dark"]
		);
	}

	const id = isDark ? darkTerminalTheme : lightTerminalTheme;
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
