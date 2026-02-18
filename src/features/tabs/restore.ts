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
			if (!result.data) return;

			// Stale profile cleanup
			const validIds = new Set(
				result.data.flatMap((p) => p.profiles.map((pr) => pr.id)),
			);
			useTabStore.getState().removeStaleProfiles(validIds);

			// One-shot tab population
			if (!restored) {
				restored = true;
				if (result.data.length === 0) {
					resolve();
				} else {
					populateTabs(result.data).finally(resolve);
				}
			}
		});
	});
}

/**
 * Populate tab store from already-live sessions (backend restored them at startup).
 * Pure reads — no mutations.
 */
async function populateTabs(projects: ProjectWithProfiles[]) {
	consola.info(`[tab-restore] populating tabs for ${projects.length} projects`);

	const projectData = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			ptySessions: await listProjectSessions({ projectId: p.id }),
			agentSessions: await listProjectAgentSessions({
				projectId: p.id,
			}),
		})),
	);

	// PTY sessions: wrap in session objects, add to tab store
	for (const { ptySessions } of projectData) {
		for (const s of ptySessions) {
			const ts = new TerminalTabSession(s.id, s.profile_id, s.title);
			sessionRegistry.set(ts.id, ts);
			useTabStore.getState().addTab(s.profile_id, ts.toTab());
			consola.info(`[tab-restore] PTY ${s.id}`);
		}
	}

	// Agent sessions: only create tab entries (no process spawning).
	// The actual reconnection (spawn + listener) happens lazily on tab focus.
	for (const { agentSessions } of projectData) {
		for (const r of agentSessions) {
			const ts = new AgentTabSession(
				r.id,
				r.profile_id,
				`${r.agent} session`,
				r.agent,
			);
			sessionRegistry.set(ts.id, ts);
			useTabStore.getState().addTab(r.profile_id, ts.toTab());
			consola.info(`[tab-restore] Agent tab ${r.id} (pending reconnect)`);
		}
	}

	consola.info("[tab-restore] complete");
}
