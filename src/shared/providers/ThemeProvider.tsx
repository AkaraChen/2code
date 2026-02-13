import { Box } from "@chakra-ui/react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useMemo } from "react";
import { useThemeStore } from "@/features/settings/stores/themeStore";
import type { Preference, ThemeContextValue } from "./themeContext";
import { ThemeContext } from "./themeContext";

function ThemeBridge({ children }: { children: React.ReactNode }) {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const accentColor = useThemeStore((s) => s.accentColor);

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
			<Box colorPalette={accentColor} css={{ display: "contents" }}>
				{children}
			</Box>
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
