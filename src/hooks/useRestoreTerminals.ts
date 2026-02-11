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
			for (const project of projects) {
				const sessions = await ptyApi.listActiveSessions(project.id);
				if (sessions.length === 0) continue;

				for (const session of sessions) {
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
				}
			}
		};

		restore();
	}, [projects]);
}
