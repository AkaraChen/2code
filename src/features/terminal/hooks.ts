import { useMutation } from "@tanstack/react-query";
import type { ITheme } from "@xterm/xterm";
import { use } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
} from "@/generated";
import { ThemeContext } from "@/shared/providers/themeContext";
import { useTerminalStore } from "./store";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

// TODO: Allow users to configure the default shell in settings
const DEFAULT_SHELL = "/bin/zsh";

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			profileId,
			cwd,
		}: {
			profileId: string;
			cwd: string;
		}) => {
			const counter =
				useTerminalStore.getState().profiles[profileId]?.counter ?? 0;
			const title = `Terminal ${counter + 1}`;
			const sessionId = await createPtySession({
				meta: { profileId, title },
				config: { shell: DEFAULT_SHELL, cwd, rows: 24, cols: 80 },
			});
			return { profileId, sessionId, title };
		},
		onSuccess: ({ profileId, sessionId, title }) => {
			useTerminalStore.getState().addTab(profileId, sessionId, title);
		},
	});
}

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			sessionId,
		}: {
			profileId: string;
			sessionId: string;
		}) => {
			await Promise.all([
				closePtySession({ sessionId }),
				deletePtySessionRecord({ sessionId }),
			]);
		},
		onSettled: (_data, _err, { profileId, sessionId }) => {
			useTerminalStore.getState().closeTab(profileId, sessionId);
		},
	});
}

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = use(ThemeContext);
	const darkTerminalTheme = useTerminalSettingsStore(
		(s) => s.darkTerminalTheme,
	);
	const lightTerminalTheme = useTerminalSettingsStore(
		(s) => s.lightTerminalTheme,
	);
	const syncTerminalTheme = useTerminalSettingsStore(
		(s) => s.syncTerminalTheme,
	);

	if (syncTerminalTheme) return darkTerminalTheme;
	return isDark ? darkTerminalTheme : lightTerminalTheme;
}

export function useTerminalTheme(): ITheme {
	const id = useTerminalThemeId();
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
