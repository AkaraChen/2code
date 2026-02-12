import { useMutation } from "@tanstack/react-query";
import type { ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import type { Profile, Project } from "@/generated";
import {
	closePtySession,
	createPtySession,
	deletePtySessionRecord,
	listActiveSessions,
} from "@/generated";
import { useThemePreference } from "@/shared/providers/ThemeProvider";
import { useTerminalStore } from "./store";
import type { TerminalThemeId } from "./themes";
import { terminalThemes } from "./themes";

const DEFAULT_SHELL = "/bin/zsh";

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			contextId,
			projectId,
			cwd,
		}: {
			contextId: string;
			projectId: string;
			cwd: string;
		}) => {
			const counter =
				useTerminalStore.getState().projects[contextId]?.counter ?? 0;
			const title = `Terminal ${counter + 1}`;
			const sessionId = await createPtySession({
				meta: { projectId, title },
				config: { shell: DEFAULT_SHELL, cwd, rows: 24, cols: 80 },
			});
			return { contextId, sessionId, title };
		},
		onSuccess: ({ contextId, sessionId, title }) => {
			useTerminalStore.getState().addTab(contextId, sessionId, title);
		},
	});
}

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			sessionId,
		}: {
			contextId: string;
			sessionId: string;
		}) => {
			await Promise.all([
				closePtySession({ sessionId }).catch(() => {}),
				deletePtySessionRecord({ sessionId }).catch(() => {}),
			]);
		},
		onSettled: (_data, _err, { contextId, sessionId }) => {
			useTerminalStore.getState().closeTab(contextId, sessionId);
		},
	});
}

export function useRestoreTerminals(
	projects: Project[] | undefined,
	profiles: Profile[],
) {
	const didRestore = useRef(false);

	useEffect(() => {
		if (!projects || projects.length === 0 || didRestore.current) return;
		didRestore.current = true;

		const restore = async () => {
			// Build a map from worktree_path → profileId for context resolution
			const worktreeToProfile = new Map<string, string>();
			for (const profile of profiles) {
				worktreeToProfile.set(profile.worktree_path, profile.id);
			}

			const projectSessions = await Promise.all(
				projects.map(async (project) => ({
					project,
					sessions: await listActiveSessions({
						projectId: project.id,
					}),
				})),
			);

			await Promise.all(
				projectSessions.flatMap(({ project, sessions }) =>
					sessions.map(async (session) => {
						// Determine context ID: if cwd matches a profile worktree, use profile ID
						const contextId =
							worktreeToProfile.get(session.cwd) ?? project.id;

						const newSessionId = await createPtySession({
							meta: {
								projectId: project.id,
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
								contextId,
								newSessionId,
								session.title,
								session.id,
							);
					}),
				),
			);
		};

		restore();
	}, [projects, profiles]);
}

export function useTerminalThemeId(): TerminalThemeId {
	const { isDark } = useThemePreference();
	const darkTerminalTheme = useTerminalSettingsStore((s) => s.darkTerminalTheme);
	const lightTerminalTheme = useTerminalSettingsStore((s) => s.lightTerminalTheme);
	const syncTerminalTheme = useTerminalSettingsStore((s) => s.syncTerminalTheme);

	if (syncTerminalTheme) return darkTerminalTheme;
	return isDark ? darkTerminalTheme : lightTerminalTheme;
}

export function useTerminalTheme(): ITheme {
	const id = useTerminalThemeId();
	return terminalThemes[id] ?? terminalThemes["github-dark"];
}
