import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import type { ProjectWithProfiles } from "@/generated";
import {
	listProjectSessions,
	listProjects,
	restorePtySession,
} from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { removeTerminalStorage, sweepTerminalStorage } from "./lib";
import { useTerminalStore } from "./store";

/**
 * Transient scrollback data for restored sessions.
 * Written during restoration, consumed once by Terminal.tsx on mount, then deleted.
 */
export const sessionHistory = new Map<string, Uint8Array>();

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
				restoreTerminals(result.data).finally(() => {
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

async function restoreTerminals(projects: ProjectWithProfiles[]) {
	const projectSessions = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			sessions: await listProjectSessions({ projectId: p.id }),
		})),
	);

	const allSessions = projectSessions.flatMap(({ sessions }) => sessions);
	if (allSessions.length > 0) {
		await mapWithLimit(allSessions, 3, async (session) => {
			try {
				const result = await restorePtySession({
					oldSessionId: session.id,
					meta: { profileId: session.profile_id, title: session.title },
					config: {
						shell: session.shell,
						cwd: session.cwd,
						rows: session.rows,
						cols: session.cols,
						startupCommands: [],
					},
				});

				removeTerminalStorage(session.id);

				if (result.history.length > 0) {
					sessionHistory.set(
						result.newSessionId,
						new Uint8Array(result.history),
					);
				}

				useTerminalStore
					.getState()
					.addTab(session.profile_id, result.newSessionId, session.title);
			} catch (e) {
				consola.error(`[pty-restore] failed: ${session.id}`, e);
			}
		});
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

export async function mapWithLimit<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
) {
	const executing = new Set<Promise<void>>();
	for (const item of items) {
		const p = fn(item).then(() => {
			executing.delete(p);
		});
		executing.add(p);
		if (executing.size >= limit) await Promise.race(executing);
	}
	await Promise.all(executing);
}
