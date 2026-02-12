import { Box } from "@chakra-ui/react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { createContext, use, useEffect, useMemo } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	BORDER_RADIUS_MAP,
	useThemeStore,
} from "@/features/settings/stores/themeStore";

type Preference = "system" | "light" | "dark";

interface ThemeContextValue {
	preference: Preference;
	setPreference: (p: Preference) => void;
	isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
	preference: "system",
	setPreference: () => {},
	isDark: true,
});

function ThemeBridge({ children }: { children: React.ReactNode }) {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const accentColor = useThemeStore((s) => s.accentColor);
	const borderRadius = useThemeStore((s) => s.borderRadius);
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);

	useEffect(() => {
		const radii = BORDER_RADIUS_MAP[borderRadius];
		const root = document.documentElement;
		root.style.setProperty("--chakra-radii-l1", radii.l1);
		root.style.setProperty("--chakra-radii-l2", radii.l2);
		root.style.setProperty("--chakra-radii-l3", radii.l3);
	}, [borderRadius]);

	useEffect(() => {
		document.documentElement.style.setProperty(
			"--chakra-fonts-mono",
			`"${fontFamily}", monospace`,
		);
	}, [fontFamily]);

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

export function useThemePreference() {
	return use(ThemeContext);
}
