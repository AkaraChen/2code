import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import type { ProjectWithProfiles } from "@/generated";
import { listProjectSessions, listProjects } from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import { TerminalTabSession } from "./TerminalTabSession";

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
			consola.info("[tab-restore] projects query updated", {
				dataLength: result.data?.length,
				error: result.error,
			});
			if (!result.data) return;

			// Stale profile cleanup
			const validIds = new Set(
				result.data.flatMap((p) => p.profiles.map((pr) => pr.id)),
			);
			useTabStore.getState().removeStaleProfiles(validIds);
			consola.info("[tab-restore] cleaned up stale profiles", {
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
	consola.info(`[tab-restore] starting for ${projects.length} projects`);

	const projectSessions = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			sessions: await listProjectSessions({ projectId: p.id }),
		})),
	);

	const allSessions = projectSessions.flatMap(({ sessions }) => sessions);
	consola.info(`[tab-restore] found ${allSessions.length} sessions`);
	if (allSessions.length === 0) return;

	await mapWithLimit(allSessions, 3, async (session) => {
		try {
			const { session: tabSession, history } =
				await TerminalTabSession.restore(session);
			sessionRegistry.set(tabSession.id, tabSession);

			if (history.length > 0) {
				sessionHistory.set(tabSession.id, history);
			}

			useTabStore
				.getState()
				.addTab(session.profile_id, tabSession.toTab());
			consola.info(
				`[tab-restore] ${session.id} → ${tabSession.id}`,
			);
		} catch (e) {
			consola.error(`[tab-restore] failed: ${session.id}`, e);
		}
	});

	consola.info("[tab-restore] complete");
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
