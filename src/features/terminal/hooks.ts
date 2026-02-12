import { useMutation } from "@tanstack/react-query";
import type { ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import type { Project } from "@/generated";
import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
	listProjectSessions,
} from "@/generated";
import { useThemePreference } from "@/shared/providers/ThemeProvider";
import { useTerminalStore } from "./store";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

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
				closePtySession({ sessionId }).catch(() => {}),
				deletePtySessionRecord({ sessionId }).catch(() => {}),
			]);
		},
		onSettled: (_data, _err, { profileId, sessionId }) => {
			useTerminalStore.getState().closeTab(profileId, sessionId);
		},
	});
}

export function useRestoreTerminals(projects: Project[] | undefined) {
	const didRestore = useRef(false);

	useEffect(() => {
		if (!projects || projects.length === 0 || didRestore.current) return;
		didRestore.current = true;

		const restore = async () => {
			const projectSessions = await Promise.all(
				projects.map(async (project) => ({
					project,
					sessions: await listProjectSessions({
						projectId: project.id,
					}),
				})),
			);

			await Promise.all(
				projectSessions.flatMap(({ sessions }) =>
					sessions.map(async (session) => {
						const newSessionId = await createPtySession({
							meta: {
								profileId: session.profile_id,
								title: session.title,
							},
							config: {
								shell: session.shell,
								cwd: session.cwd,
								rows: 24,
								cols: 80,
							},
						});
						useTerminalStore
							.getState()
							.addTab(
								session.profile_id,
								newSessionId,
								session.title,
								session.id,
							);
					}),
				),
			);
		};

		restore();
	}, [projects]);
}

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = useThemePreference();
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
