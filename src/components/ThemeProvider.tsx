import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { createContext, use, useMemo } from "react";

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

	const value = useMemo<ThemeContextValue>(
		() => ({
			preference: (theme as Preference) ?? "system",
			setPreference: (p: Preference) => setTheme(p),
			isDark: resolvedTheme === "dark",
		}),
		[theme, setTheme, resolvedTheme],
	);

	return <ThemeContext value={value}>{children}</ThemeContext>;
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
