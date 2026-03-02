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
 * Reconciles with persisted frontend state to preserve split layouts and prevent duplication.
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

	for (const { project, ptySessions, agentSessions } of projectData) {
		for (const p of project.profiles) {
			const profilePtySessions = ptySessions.filter(s => s.profile_id === p.id);
			const profileAgentSessions = agentSessions.filter(s => s.profile_id === p.id);

			if (profilePtySessions.length === 0 && profileAgentSessions.length === 0) continue;

			// 1. Initialize session objects in registry
			profilePtySessions.forEach(s => {
				const ts = new TerminalTabSession(s.id, s.profile_id, s.title);
				sessionRegistry.set(s.id, ts);
			});
			profileAgentSessions.forEach(r => {
				const ts = new AgentTabSession(r.id, r.profile_id, `${r.agent} session`, r.agent);
				sessionRegistry.set(r.id, ts);
			});

			// 2. Reconcile if profile exists, otherwise add fresh
			if (store.profiles[p.id]) {
				consola.info(`[tab-restore] reconciling profile ${p.id} (${profilePtySessions.length} PTY, ${profileAgentSessions.length} Agent)`);
				store.reconcileProfile(p.id, profilePtySessions, profileAgentSessions);
			} else {
				consola.info(`[tab-restore] populating new profile ${p.id}`);
				profilePtySessions.forEach(s => {
					const ts = sessionRegistry.get(s.id) as TerminalTabSession;
					store.addTab(p.id, ts.toTab());
				});
				profileAgentSessions.forEach(r => {
					const ts = sessionRegistry.get(r.id) as AgentTabSession;
					store.addTab(p.id, ts.toTab());
				});
			}
		}
	}

	consola.info("[tab-restore] complete");
}
