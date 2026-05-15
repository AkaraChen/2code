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
import { collectProjectSessions } from "./restorationCollections";
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

		observer.subscribe((result) => {
			consola.info("[pty-restore] projects query updated", {
				dataLength: result.data?.length,
				error: result.error,
			});
			if (!result.data) return;

			// Stale profile cleanup
			const validIds = new Set(
				result.data.flatMap((p) => p.profiles.map((pr) => pr.id)),
			);
			useTerminalStore.getState().removeStaleProfiles(validIds);
			consola.info("[pty-restore] cleaned up stale profiles", {
				validCount: validIds.size,
			});

			// One-shot restoration
			if (!restored) {
				restored = true;
				if (result.data.length === 0) {
					resolve();
				} else {
					restoreTerminals(result.data).finally(resolve);
				}
			}
		});
	});
}

async function restoreTerminals(projects: ProjectWithProfiles[]) {
	consola.info(`[pty-restore] starting for ${projects.length} projects`);

	const projectSessions = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			sessions: await listProjectSessions({ projectId: p.id }),
		})),
	);

	const allSessions = collectProjectSessions(projectSessions);
	consola.info(`[pty-restore] found ${allSessions.length} sessions`);
	if (allSessions.length === 0) return;

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
			consola.info(`[pty-restore] restorePtySession result`, {
				newSessionId: result.newSessionId,
				historyLength: result.history.length,
			});

			if (result.history.length > 0) {
				sessionHistory.set(
					result.newSessionId,
					new Uint8Array(result.history),
				);
			}

			useTerminalStore
				.getState()
				.addTab(session.profile_id, result.newSessionId, session.title);
			consola.info(
				`[pty-restore] ${session.id} → ${result.newSessionId}`,
			);
		} catch (e) {
			consola.error(`[pty-restore] failed: ${session.id}`, e);
		}
	});

	consola.info("[pty-restore] complete");
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
