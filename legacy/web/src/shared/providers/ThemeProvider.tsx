import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { isLinuxPlatform } from "@/shared/lib/platform";
import type { Preference, ThemeContextValue } from "./themeContext";
import { ThemeContext } from "./themeContext";

// next-themes keeps the preference in localStorage, but the settings
// window and the main window are separate webviews — a change in one
// does not reach the other until reload. Broadcast the preference so
// both windows switch together; applying a received preference goes
// through setTheme directly and is not re-broadcast.
const themeChannel =
	typeof BroadcastChannel !== "undefined"
		? new BroadcastChannel("sync:color-theme")
		: null;

let remoteThemeVersion = 0;
const getRemoteThemeVersion = () => remoteThemeVersion;

function ThemeBridge({ children }: { children: React.ReactNode }) {
	const { theme, setTheme, resolvedTheme } = useTheme();

	useEffect(() => {
		if (!isLinuxPlatform() || !resolvedTheme) return;

		void getCurrentWindow()
			.setTheme(resolvedTheme === "dark" ? "dark" : "light")
			.catch((error) => {
				console.error("Failed to sync Linux window theme", error);
			});
	}, [resolvedTheme]);

	const setPreference = useCallback(
		(preference: Preference) => {
			setTheme(preference);
			themeChannel?.postMessage(preference);
		},
		[setTheme],
	);

	// The channel is an external store of remote preference broadcasts:
	// useSyncExternalStore owns the listener lifecycle, the message
	// handler applies the preference, and the version snapshot marks
	// each received message.
	const subscribeToRemoteTheme = useCallback(
		(notify: () => void) => {
			if (!themeChannel) return () => {};
			const onMessage = (event: MessageEvent<Preference>) => {
				remoteThemeVersion++;
				setTheme(event.data);
				notify();
			};
			themeChannel.addEventListener("message", onMessage);
			return () =>
				themeChannel.removeEventListener("message", onMessage);
		},
		[setTheme],
	);
	useSyncExternalStore(
		subscribeToRemoteTheme,
		getRemoteThemeVersion,
		getRemoteThemeVersion,
	);

	const value = useMemo<ThemeContextValue>(
		() => ({
			preference: (theme as Preference) ?? "system",
			setPreference,
			isDark: resolvedTheme === "dark",
		}),
		[theme, setPreference, resolvedTheme],
	);

	return (
		<ThemeContext value={value}>
			{children}
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
