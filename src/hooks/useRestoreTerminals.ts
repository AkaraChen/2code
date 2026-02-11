import { useEffect, useRef } from "react";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";
import type { Profile, Project } from "@/types";

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
					sessions: await ptyApi.listActiveSessions(project.id),
				})),
			);

			await Promise.all(
				projectSessions.flatMap(({ project, sessions }) =>
					sessions.map(async (session) => {
						// Determine context ID: if cwd matches a profile worktree, use profile ID
						const contextId =
							worktreeToProfile.get(session.cwd) ?? project.id;

						const newSessionId = await ptyApi.createSession(
							project.id,
							session.title,
							session.shell,
							session.cwd,
							24,
							80,
						);
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
