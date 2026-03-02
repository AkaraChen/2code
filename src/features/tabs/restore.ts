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
 *
 * Since the backend preserves session IDs across restarts, the persisted
 * frontend state already references the correct IDs. We only need to:
 * 1. Register session objects in the runtime registry (for close/write etc.)
 * 2. Add tabs for any sessions that aren't already in the persisted store.
 */
async function populateTabs(projects: ProjectWithProfiles[]) {
	consola.info(`[tab-restore] populating tabs for ${projects.length} projects`);

	const projectData = await Promise.all(
		projects.map(async (p) => {
			const [ptySessions, agentSessions] = await Promise.all([
				listProjectSessions({ projectId: p.id }),
				listProjectAgentSessions({ projectId: p.id }),
			]);
			return { project: p, ptySessions, agentSessions };
		}),
	);

	const store = useTabStore.getState();

	// Collect all session IDs already known to the persisted store
	const knownSessionIds = new Set<string>();
	for (const profile of Object.values(store.profiles)) {
		for (const tab of profile.tabs) {
			if (tab.type === "terminal") {
				for (const pane of tab.panes) {
					knownSessionIds.add(pane.sessionId);
				}
			} else if (tab.type === "agent") {
				knownSessionIds.add(tab.sessionId);
			}
		}
	}

	for (const { ptySessions, agentSessions } of projectData) {
		// 1. Register PTY session objects + add tabs for unknown sessions
		for (const s of ptySessions) {
			const ts = new TerminalTabSession(s.id, s.profile_id, s.title);
			sessionRegistry.set(s.id, ts);

			if (!knownSessionIds.has(s.id)) {
				store.addTab(s.profile_id, ts.toTab());
				consola.info(`[tab-restore] added new PTY tab ${s.id}`);
			} else {
				consola.info(`[tab-restore] registered PTY ${s.id} (already in store)`);
			}
		}

		// 2. Register Agent session objects + add tabs for unknown sessions
		for (const r of agentSessions) {
			const ts = new AgentTabSession(r.id, r.profile_id, `${r.agent} session`, r.agent);
			sessionRegistry.set(r.id, ts);

			if (!knownSessionIds.has(r.id)) {
				store.addTab(r.profile_id, ts.toTab());
				consola.info(`[tab-restore] added new Agent tab ${r.id}`);
			} else {
				consola.info(`[tab-restore] registered Agent ${r.id} (already in store)`);
			}
		}
	}

	consola.info("[tab-restore] complete");
}
