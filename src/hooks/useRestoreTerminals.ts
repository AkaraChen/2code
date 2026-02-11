import { useEffect, useRef } from "react";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";
import type { Project } from "@/types";

export function useRestoreTerminals(projects: Project[] | undefined) {
	const didRestore = useRef(false);

	useEffect(() => {
		if (!projects || projects.length === 0 || didRestore.current) return;
		didRestore.current = true;

		const restore = async () => {
			const projectSessions = await Promise.all(
				projects.map(async (project) => ({
					project,
					sessions: await ptyApi.listActiveSessions(project.id),
				})),
			);

			await Promise.all(
				projectSessions.flatMap(({ project, sessions }) =>
					sessions.map(async (session) => {
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
								project.id,
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
