import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import type { ProjectWithProfiles } from "@/generated";
import { listProjectSessions, listProjects } from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { sweepTerminalStorage } from "./lib";
import { useTerminalStore } from "./store";

/**
 * Module-level restoration promise.
 * TerminalLayer uses `use(restorationPromise)` so Suspense handles loading.
 */
export const restorationPromise: Promise<void> = createRestorationPipeline();

function createRestorationPipeline(): Promise<void> {
	return new Promise<void>((resolve) => {
		const observer = new QueryObserver<ProjectWithProfiles[]>(queryClient, {
			queryKey: queryKeys.projects.all,
			queryFn: listProjects,
		});

		let restored = false;
		let released = false;
		let shouldRelease = false;
		let unsubscribe: (() => void) | null = null;

		const releaseObserver = () => {
			if (released) return;
			if (!unsubscribe) {
				shouldRelease = true;
				return;
			}
			released = true;
			unsubscribe();
			observer.destroy();
		};

		unsubscribe = observer.subscribe((result) => {
			if (!result.data) return;
			if (restored) return;

			restored = true;

			// Stale profile cleanup
			const validIds = new Set(
				result.data.flatMap((p) => p.profiles.map((pr) => pr.id)),
			);
			useTerminalStore.getState().removeStaleProfiles(validIds);

			// One-shot restoration
			if (result.data.length === 0) {
				releaseObserver();
				resolve();
			} else {
				loadRestorableTerminals(result.data).finally(() => {
					releaseObserver();
					resolve();
				});
			}
		});

		if (shouldRelease) {
			releaseObserver();
		}
	});
}

async function loadRestorableTerminals(projects: ProjectWithProfiles[]) {
	const projectSessions = await Promise.all(
		projects.map((p) => listProjectSessions({ projectId: p.id })),
	);

	const allSessions = projectSessions.flat();
	if (allSessions.length > 0) {
		for (const session of allSessions) {
			useTerminalStore.getState().addRestoringTab(
				session.profile_id,
				session.id,
				session.title,
				{
					oldSessionId: session.id,
					shell: session.shell,
					cwd: session.cwd,
					rows: session.rows,
					cols: session.cols,
				},
			);
		}
	}

	const liveSessionIds = new Set(
		Object.values(useTerminalStore.getState().profiles).flatMap((profile) =>
			profile.tabs.map((tab) => tab.id)
		),
	);
	const removed = sweepTerminalStorage(liveSessionIds);
	if (removed > 0) {
		consola.debug(`[pty-restore] swept ${removed} stale terminal storage keys`);
	}
}
