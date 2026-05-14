import { useMutation } from "@tanstack/react-query";
import type { ITheme } from "@xterm/xterm";
import { use } from "react";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
} from "@/generated";
import { ThemeContext } from "@/shared/providers/themeContext";
import { useTerminalStore } from "./store";
import { DEFAULT_TERMINAL_SHELL } from "./templates";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			profileId,
			cwd,
			title,
			shell,
			startupCommands = [],
		}: {
			profileId: string;
			cwd: string;
			title?: string;
			shell?: string;
			startupCommands?: string[];
		}) => {
			const terminalSettings = useTerminalSettingsStore.getState();
			const counter =
				useTerminalStore.getState().profiles[profileId]?.counter ?? 0;
			const nextTitle = title ?? `Terminal ${counter + 1}`;
			const sessionId = await createPtySession({
				meta: { profileId, title: nextTitle },
				config: {
					shell:
						shell ||
						terminalSettings.defaultShell ||
						DEFAULT_TERMINAL_SHELL,
					cwd,
					rows: 24,
					cols: 80,
					startupCommands,
				},
			});
			return { profileId, sessionId, title: nextTitle };
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
			const terminalProfile = useTerminalStore.getState().profiles[profileId];
			const isLastTab =
				terminalProfile?.tabs.length === 1 &&
				terminalProfile.tabs[0]?.id === sessionId;

			useTerminalStore.getState().closeTab(profileId, sessionId);

			if (isLastTab) {
				const fileProfile = useFileViewerTabsStore.getState().profiles[profileId];
				if (fileProfile && fileProfile.tabs.length > 0) {
					const target = fileProfile.activeFilePath ?? fileProfile.tabs[0].filePath;
					useFileViewerTabsStore.getState().setFileActive(profileId, target);
				}
			}
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

export { DEFAULT_TERMINAL_SHELL } from "./templates";
