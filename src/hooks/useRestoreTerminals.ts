import { useEffect, useRef } from "react";
import type { Profile, Project } from "@/generated";
import { createPtySession, listActiveSessions } from "@/generated";
import { useTerminalStore } from "@/stores/terminalStore";

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
