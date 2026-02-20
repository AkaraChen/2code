import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import { nanoid } from "nanoid";
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
import type { ProfileTabState } from "./store";
import { TerminalTabSession } from "./TerminalTabSession";
import type { AgentTab, ProfileTab, TerminalPane } from "./types";

type PtySession = Awaited<ReturnType<typeof listProjectSessions>>[number];
type AgentSession = Awaited<ReturnType<typeof listProjectAgentSessions>>[number];

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

			// Stale profile cleanup (runs on every emission)
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
 *
 * When a persisted layout exists in localStorage (from the previous session), we
 * use positional matching to map new backend session IDs to the persisted pane
 * slots, preserving split-pane groupings across restarts.
 *
 * Matching algorithm:
 *   - `sessionOrder` (persisted) holds the original PTY session IDs in creation order.
 *   - Backend returns new sessions in `created_at ASC` order — the same relative order.
 *   - Positional map: sessionOrder[i] → newSessions[i]
 *   - Agent session IDs are stable across restarts (no mapping needed).
 */
async function populateTabs(projects: ProjectWithProfiles[]) {
	consola.info(`[tab-restore] populating tabs for ${projects.length} projects`);

	const projectData = await Promise.all(
		projects.map(async (p) => ({
			project: p,
			ptySessions: await listProjectSessions({ projectId: p.id }),
			agentSessions: await listProjectAgentSessions({ projectId: p.id }),
		})),
	);

	// Group sessions by profile_id
	const ptyByProfile = new Map<string, PtySession[]>();
	for (const { ptySessions } of projectData) {
		for (const s of ptySessions) {
			const list = ptyByProfile.get(s.profile_id) ?? [];
			list.push(s);
			ptyByProfile.set(s.profile_id, list);
		}
	}

	const agentByProfile = new Map<string, AgentSession[]>();
	for (const { agentSessions } of projectData) {
		for (const r of agentSessions) {
			const list = agentByProfile.get(r.profile_id) ?? [];
			list.push(r);
			agentByProfile.set(r.profile_id, list);
		}
	}

	// Profiles with a persisted layout: restore using positional session matching
	const persistedProfiles = useTabStore.getState().profiles;
	const handledProfiles = new Set<string>();

	for (const [profileId, persistedState] of Object.entries(persistedProfiles)) {
		handledProfiles.add(profileId);

		const newPtySessions = ptyByProfile.get(profileId) ?? [];
		const newAgentSessions = agentByProfile.get(profileId) ?? [];

		// Build old→new session ID map: positional match using creation order
		const oldToNew = new Map<string, string>();
		const matchCount = Math.min(
			persistedState.sessionOrder.length,
			newPtySessions.length,
		);
		for (let i = 0; i < matchCount; i++) {
			oldToNew.set(persistedState.sessionOrder[i], newPtySessions[i].id);
		}

		// Build agent session lookup by stable ID
		const agentById = new Map(newAgentSessions.map((a) => [a.id, a]));

		// Patch tabs: replace old session IDs with new ones
		const patchedTabs: ProfileTab[] = [];
		const newSessionOrder: string[] = [];

		for (const tab of persistedState.tabs) {
			if (tab.type === "terminal") {
				const newPanes: TerminalPane[] = tab.panes
					.map((pane) => {
						const newId = oldToNew.get(pane.sessionId);
						if (!newId) return null;
						return { ...pane, sessionId: newId };
					})
					.filter((p): p is TerminalPane => p !== null);

				if (newPanes.length === 0) continue; // all panes lost, drop tab

				const newActivePaneId =
					oldToNew.get(tab.activePaneId) ?? newPanes[0].sessionId;

				patchedTabs.push({
					...tab,
					panes: newPanes,
					activePaneId: newActivePaneId,
				});
				for (const pane of newPanes) {
					newSessionOrder.push(pane.sessionId);
				}
			} else {
				// Agent tab: match by stable backend session ID
				if (agentById.has(tab.sessionId)) {
					patchedTabs.push(tab); // sessionId and nanoid id both preserved
					agentById.delete(tab.sessionId);
				}
				// else: agent session was deleted, drop the tab
			}
		}

		// Extra agent sessions not in persisted layout → new tabs
		for (const [, r] of agentById) {
			const newTab: AgentTab = {
				type: "agent",
				id: nanoid(),
				sessionId: r.id,
				title: `${r.agent} session`,
				agentType: r.agent,
			};
			patchedTabs.push(newTab);
		}

		// Extra PTY sessions not matched to any persisted pane → new single-pane tabs
		const matchedNewIds = new Set(oldToNew.values());
		for (const s of newPtySessions) {
			if (!matchedNewIds.has(s.id)) {
				patchedTabs.push({
					type: "terminal",
					id: nanoid(),
					title: s.title,
					panes: [{ sessionId: s.id, title: s.title }],
					activePaneId: s.id,
				});
				newSessionOrder.push(s.id);
			}
		}

		// Register all sessions in the registry
		for (const s of newPtySessions) {
			const ts = new TerminalTabSession(s.id, s.profile_id, s.title);
			sessionRegistry.set(ts.id, ts);
		}
		for (const r of newAgentSessions) {
			const ts = new AgentTabSession(r.id, r.profile_id, `${r.agent} session`, r.agent);
			sessionRegistry.set(ts.id, ts);
		}

		// Keep persisted activeTabId if the tab still exists, else fall back to first
		const activeTabId = patchedTabs.some((t) => t.id === persistedState.activeTabId)
			? persistedState.activeTabId
			: (patchedTabs[0]?.id ?? null);

		const restoredState: ProfileTabState = {
			tabs: patchedTabs,
			activeTabId,
			counter: persistedState.counter,
			sessionOrder: newSessionOrder,
		};
		useTabStore.getState().restoreProfile(profileId, restoredState);

		consola.info(
			`[tab-restore] profile ${profileId}: ${patchedTabs.length} tabs restored`,
		);
	}

	// Profiles with no persisted layout: fall back to one tab per session (first run)
	for (const [profileId, sessions] of ptyByProfile) {
		if (handledProfiles.has(profileId)) continue;
		for (const s of sessions) {
			const ts = new TerminalTabSession(s.id, s.profile_id, s.title);
			sessionRegistry.set(ts.id, ts);
			useTabStore.getState().addTab(s.profile_id, ts.toTab());
			consola.info(`[tab-restore] PTY ${s.id} (no persisted layout)`);
		}
	}
	for (const [profileId, sessions] of agentByProfile) {
		if (handledProfiles.has(profileId)) continue;
		for (const r of sessions) {
			const ts = new AgentTabSession(r.id, r.profile_id, `${r.agent} session`, r.agent);
			sessionRegistry.set(ts.id, ts);
			useTabStore.getState().addTab(r.profile_id, ts.toTab());
			consola.info(`[tab-restore] Agent ${r.id} (no persisted layout)`);
		}
	}

	consola.info("[tab-restore] complete");
}
