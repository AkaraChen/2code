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
import {
	type TerminalSplitDirection,
	useTerminalStore,
} from "./store";
import { DEFAULT_TERMINAL_SHELL } from "./templates";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

async function closeSessions(sessionIds: string[]) {
	await Promise.all(
		sessionIds.map((sessionId) =>
			Promise.all([
				closePtySession({ sessionId }),
				deletePtySessionRecord({ sessionId }),
			]),
		),
	);
}

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			profileId,
			cwd,
			title,
			shell = DEFAULT_TERMINAL_SHELL,
			startupCommands = [],
		}: {
			profileId: string;
			cwd: string;
			title?: string;
			shell?: string;
			startupCommands?: string[];
		}) => {
			const counter =
				useTerminalStore.getState().profiles[profileId]?.counter ?? 0;
			const nextTitle = title ?? `Terminal ${counter + 1}`;
			const sessionId = await createPtySession({
				meta: { profileId, title: nextTitle },
				config: {
					shell,
					cwd,
					rows: 24,
					cols: 80,
					startupCommands,
				},
			});
			return { profileId, sessionId, title: nextTitle, cwd, shell };
		},
		onSuccess: ({ profileId, sessionId, title, cwd, shell }) => {
			useTerminalStore
				.getState()
				.addTab(profileId, sessionId, title, cwd, shell);
		},
	});
}

export function useSplitTerminalPane() {
	return useMutation({
		mutationFn: async ({
			profileId,
			tabId,
			direction,
			cwd,
			title,
			shell = DEFAULT_TERMINAL_SHELL,
			startupCommands = [],
		}: {
			profileId: string;
			tabId: string;
			direction: TerminalSplitDirection;
			cwd: string;
			title?: string;
			shell?: string;
			startupCommands?: string[];
		}) => {
			const counter =
				useTerminalStore.getState().profiles[profileId]?.counter ?? 0;
			const nextTitle = title ?? `Terminal ${counter + 1}`;
			const sessionId = await createPtySession({
				meta: { profileId, title: nextTitle },
				config: {
					shell,
					cwd,
					rows: 24,
					cols: 80,
					startupCommands,
				},
			});

			return {
				profileId,
				tabId,
				direction,
				sessionId,
				title: nextTitle,
				cwd,
				shell,
			};
		},
		onSuccess: ({ profileId, tabId, direction, sessionId, title, cwd, shell }) => {
			const profile = useTerminalStore.getState().profiles[profileId];
			const tab = profile?.tabs.find((candidate) => candidate.id === tabId);

			if (!tab || tab.panes.length >= 2) {
				void closeSessions([sessionId]);
				return;
			}

			useTerminalStore.getState().splitTab(profileId, tabId, direction, {
				sessionId,
				title,
				cwd,
				shell,
			});
		},
	});
}

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			profileId,
			tabId,
		}: {
			profileId: string;
			tabId: string;
		}) => {
			const tab = useTerminalStore
				.getState()
				.profiles[profileId]
				?.tabs.find((candidate) => candidate.id === tabId);

			if (!tab) return;
			await closeSessions(tab.panes.map((pane) => pane.sessionId));
		},
		onSettled: (_data, _err, { profileId, tabId }) => {
			useTerminalStore.getState().closeTab(profileId, tabId);
		},
	});
}

export function useCloseTerminalPane() {
	return useMutation({
		mutationFn: async ({
			sessionId,
		}: {
			profileId: string;
			tabId: string;
			sessionId: string;
		}) => {
			await closeSessions([sessionId]);
		},
		onSettled: (_data, _err, { profileId, tabId, sessionId }) => {
			useTerminalStore.getState().closePane(profileId, tabId, sessionId);
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
