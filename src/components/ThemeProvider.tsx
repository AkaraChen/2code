import { GlobalTheme } from "@carbon/react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";

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

const STORAGE_KEY = "theme-preference";

function readStoredPreference(): Preference {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "light" || stored === "dark" || stored === "system") {
		return stored;
	}
	return "system";
}

function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => window.matchMedia(query).matches,
	);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [preference, setPreferenceState] =
		useState<Preference>(readStoredPreference);
	const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

	const isDark =
		preference === "dark" || (preference === "system" && prefersDark);
	const resolvedTheme = isDark ? "g100" : "white";

	const setPreference = useCallback((p: Preference) => {
		localStorage.setItem(STORAGE_KEY, p);
		setPreferenceState(p);
	}, []);

	useEffect(() => {
		document.documentElement.dataset.carbonTheme = resolvedTheme;
	}, [resolvedTheme]);

	return (
		<ThemeContext value={{ preference, setPreference, isDark }}>
			<GlobalTheme theme={resolvedTheme}>{children}</GlobalTheme>
		</ThemeContext>
	);
}

export function useThemePreference() {
	return useContext(ThemeContext);
}
