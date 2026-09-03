import { createContext } from "react";

export type Preference = "system" | "light" | "dark";

export interface ThemeContextValue {
	preference: Preference;
	setPreference: (p: Preference) => void;
	isDark: boolean;
}

export const ThemeContext = createContext<ThemeContextValue>({
	preference: "system",
	setPreference: () => {},
	isDark: true,
});
