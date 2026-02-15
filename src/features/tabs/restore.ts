import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import type { ProjectWithProfiles } from "@/generated";
import {
	listProjectAgentSessions,
	listProjectSessions,
	listProjects,
} from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { AgentTabSession } from "./AgentTabSession";
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

	// Fetch both PTY and Agent sessions in parallel
	const projectData = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			ptySessions: await listProjectSessions({ projectId: p.id }),
			agentSessions: await listProjectAgentSessions({ projectId: p.id }),
		})),
	);

	const allPtySessions = projectData.flatMap(({ ptySessions }) => ptySessions);
	const allAgentSessions = projectData.flatMap(
		({ agentSessions }) => agentSessions,
	);

	consola.info(
		`[tab-restore] found ${allPtySessions.length} PTY sessions, ${allAgentSessions.length} agent sessions`,
	);

	// Restore PTY sessions
	if (allPtySessions.length > 0) {
		await mapWithLimit(allPtySessions, 3, async (session) => {
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
				consola.info(`[tab-restore] PTY ${session.id} → ${tabSession.id}`);
			} catch (e) {
				consola.error(`[tab-restore] PTY failed: ${session.id}`, e);
			}
		});
	}

	// Restore Agent sessions
	if (allAgentSessions.length > 0) {
		// Find default profile for each project to use as cwd
		const profileCwdMap = new Map<string, string>();
		for (const { project } of projectData) {
			const defaultProfile = project.profiles.find((p) => p.is_default);
			if (defaultProfile) {
				for (const profile of project.profiles) {
					// Use default profile's worktree as cwd for all profiles in project
					profileCwdMap.set(profile.id, defaultProfile.worktree_path);
				}
			}
		}

		await mapWithLimit(allAgentSessions, 3, async (record) => {
			try {
				const cwd = profileCwdMap.get(record.profile_id) || "/tmp";
				const { session: tabSession } = await AgentTabSession.restore(
					record,
					cwd,
				);
				sessionRegistry.set(tabSession.id, tabSession);

				useTabStore
					.getState()
					.addTab(record.profile_id, tabSession.toTab());
				consola.info(
					`[tab-restore] Agent ${record.id} → ${tabSession.id}`,
				);
			} catch (e) {
				consola.error(`[tab-restore] Agent failed: ${record.id}`, e);
			}
		});
	}

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
