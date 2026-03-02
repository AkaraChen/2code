import { Box } from "@chakra-ui/react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores";
import type { Preference, ThemeContextValue } from "./themeContext";
import { ThemeContext } from "./themeContext";

function AccentColorWrapper({ children }: { children: React.ReactNode }) {
	const accentColor = useSettingsStore((s) => s.accentColor);
	return (
		<Box colorPalette={accentColor} css={{ display: "contents" }}>
			{children}
		</Box>
	);
}

function ThemeBridge({ children }: { children: React.ReactNode }) {
	const { theme, setTheme, resolvedTheme } = useTheme();

	const value = useMemo<ThemeContextValue>(
		() => ({
			preference: (theme as Preference) ?? "system",
			setPreference: (p: Preference) => setTheme(p),
			isDark: resolvedTheme === "dark",
		}),
		[theme, setTheme, resolvedTheme],
	);

	return (
		<ThemeContext value={value}>
			<AccentColorWrapper>{children}</AccentColorWrapper>
		</ThemeContext>
	);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
		>
			<ThemeBridge>{children}</ThemeBridge>
		</NextThemesProvider>
	);
}
