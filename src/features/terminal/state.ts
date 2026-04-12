import { QueryObserver } from "@tanstack/react-query";
import consola from "consola";
import type { ProjectWithProfiles, PtySessionRecord } from "@/generated";
import {
	listProjectSessions,
	listProjects,
	restorePtySession,
} from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import {
	readTerminalLayoutSnapshot,
	type ProjectTerminalState,
	type TerminalPane,
	type TerminalSplitDirection,
	type TerminalTab,
	useTerminalStore,
} from "./store";

/**
 * Transient scrollback data for restored sessions.
 * Written during restoration, consumed once by Terminal.tsx on mount, then deleted.
 */
export const sessionHistory = new Map<string, Uint8Array>();

interface PlannedRestorePane {
	oldSessionId: string;
	profileId: string;
	title: string;
	cwd: string;
	shell: string;
	rows: number;
	cols: number;
}

interface PlannedRestoreTab {
	id: string;
	title: string;
	activePaneId: string;
	primaryPaneId: string;
	direction: TerminalSplitDirection | null;
	panes: PlannedRestorePane[];
}

interface PlannedRestoreProfile {
	tabs: PlannedRestoreTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalRestorePlan {
	profiles: Record<string, PlannedRestoreProfile>;
	looseSessions: PlannedRestorePane[];
}

interface RestoredPaneResult extends PlannedRestorePane {
	newSessionId: string;
	history: Uint8Array;
}

function createPlannedPane(
	record: PtySessionRecord,
	profileId = record.profile_id,
	fallback?: Partial<TerminalPane>,
): PlannedRestorePane {
	return {
		oldSessionId: record.id,
		profileId,
		title: fallback?.title ?? record.title,
		cwd: fallback?.cwd ?? record.cwd,
		shell: fallback?.shell ?? record.shell,
		rows: record.rows,
		cols: record.cols,
	};
}

function countProfilePanes(profile: { tabs: Array<{ panes: unknown[] }> }) {
	return profile.tabs.reduce((total, tab) => total + tab.panes.length, 0);
}

export function buildTerminalRestorePlan(
	snapshotProfiles: Record<string, ProjectTerminalState>,
	sessions: PtySessionRecord[],
): TerminalRestorePlan {
	const sessionsById = new Map(sessions.map((session) => [session.id, session]));
	const consumedSessions = new Set<string>();
	const profiles: Record<string, PlannedRestoreProfile> = {};

	for (const [profileId, profile] of Object.entries(snapshotProfiles)) {
		const tabs: PlannedRestoreTab[] = [];

		for (const tab of profile.tabs) {
			const panes = tab.panes
				.map((pane) => {
					const session = sessionsById.get(pane.sessionId);
					if (!session || session.profile_id !== profileId) return null;
					consumedSessions.add(session.id);
					return createPlannedPane(session, profileId, pane);
				})
				.filter((pane): pane is PlannedRestorePane => pane !== null)
				.slice(0, 2);
			if (panes.length === 0) continue;

			const primaryPaneId = panes.some(
				(pane) => pane.oldSessionId === tab.primaryPaneId,
			)
				? tab.primaryPaneId
				: panes[0].oldSessionId;
			const activePaneId = panes.some(
				(pane) => pane.oldSessionId === tab.activePaneId,
			)
				? tab.activePaneId
				: panes[panes.length - 1].oldSessionId;

			tabs.push({
				id: tab.id,
				title: tab.title,
				activePaneId,
				primaryPaneId,
				direction:
					panes.length > 1
						? (tab.direction ?? "horizontal")
						: null,
				panes,
			});
		}

		if (tabs.length === 0) continue;

		profiles[profileId] = {
			tabs,
			activeTabId: tabs.some((tab) => tab.id === profile.activeTabId)
				? profile.activeTabId
				: tabs[0].id,
			counter: Math.max(profile.counter, countProfilePanes({ tabs })),
		};
	}

	const looseSessions = sessions
		.filter((session) => !consumedSessions.has(session.id))
		.map((session) => createPlannedPane(session));

	return { profiles, looseSessions };
}

function remapSessionId(
	oldSessionId: string,
	restoredPanes: Map<string, RestoredPaneResult>,
) {
	return restoredPanes.get(oldSessionId)?.newSessionId ?? oldSessionId;
}

export function rebuildTerminalProfilesFromRestorePlan(
	plan: TerminalRestorePlan,
	restoredPanes: Map<string, RestoredPaneResult>,
): Record<string, ProjectTerminalState> {
	const profiles: Record<string, ProjectTerminalState> = {};
	const snapshotProfileIds = new Set(Object.keys(plan.profiles));

	for (const [profileId, profile] of Object.entries(plan.profiles)) {
		const tabs: TerminalTab[] = [];

		for (const plannedTab of profile.tabs) {
			const panes = plannedTab.panes
				.map((pane) => restoredPanes.get(pane.oldSessionId))
				.filter((pane): pane is RestoredPaneResult => pane !== undefined)
				.map<TerminalPane>((pane) => ({
					sessionId: pane.newSessionId,
					title: pane.title,
					cwd: pane.cwd,
					shell: pane.shell,
				}));
			if (panes.length === 0) continue;

			const primaryPaneId = panes.some(
				(pane) =>
					pane.sessionId
					=== remapSessionId(plannedTab.primaryPaneId, restoredPanes),
			)
				? remapSessionId(plannedTab.primaryPaneId, restoredPanes)
				: panes[0].sessionId;
			const activePaneId = panes.some(
				(pane) =>
					pane.sessionId
					=== remapSessionId(plannedTab.activePaneId, restoredPanes),
			)
				? remapSessionId(plannedTab.activePaneId, restoredPanes)
				: panes[panes.length - 1].sessionId;
			const remappedTabId = panes.some(
				(pane) =>
					pane.sessionId === remapSessionId(plannedTab.id, restoredPanes),
			)
				? remapSessionId(plannedTab.id, restoredPanes)
				: plannedTab.id;
			const primaryPane = panes.find(
				(pane) => pane.sessionId === primaryPaneId,
			);

			tabs.push({
				id: remappedTabId,
				title: primaryPane ? plannedTab.title : panes[0].title,
				activePaneId,
				primaryPaneId,
				direction: panes.length > 1 ? plannedTab.direction : null,
				panes,
			});
		}

		if (tabs.length === 0) continue;

		const activeTabId = tabs.some(
			(tab) => tab.id === remapSessionId(profile.activeTabId ?? "", restoredPanes),
		)
			? remapSessionId(profile.activeTabId ?? "", restoredPanes)
			: tabs[0].id;

		profiles[profileId] = {
			tabs,
			activeTabId,
			counter: Math.max(profile.counter, countProfilePanes({ tabs })),
		};
	}

	for (const pane of plan.looseSessions) {
		const restoredPane = restoredPanes.get(pane.oldSessionId);
		if (!restoredPane) continue;

		const tab: TerminalTab = {
			id: restoredPane.newSessionId,
			title: restoredPane.title,
			activePaneId: restoredPane.newSessionId,
			primaryPaneId: restoredPane.newSessionId,
			direction: null,
			panes: [
				{
					sessionId: restoredPane.newSessionId,
					title: restoredPane.title,
					cwd: restoredPane.cwd,
					shell: restoredPane.shell,
				},
			],
		};

		const existing = profiles[restoredPane.profileId];
		if (!existing) {
			profiles[restoredPane.profileId] = {
				tabs: [tab],
				activeTabId: tab.id,
				counter: 1,
			};
			continue;
		}

		existing.tabs.push(tab);
		if (!snapshotProfileIds.has(restoredPane.profileId)) {
			existing.activeTabId = tab.id;
		}
		existing.counter = Math.max(
			existing.counter,
			countProfilePanes(existing),
		);
	}

	return profiles;
}

async function restorePlannedPanes(plan: TerminalRestorePlan) {
	const panesToRestore = [
		...Object.values(plan.profiles).flatMap((profile) =>
			profile.tabs.flatMap((tab) => tab.panes),
		),
		...plan.looseSessions,
	];

	const restoredPanes = new Map<string, RestoredPaneResult>();
	if (panesToRestore.length === 0) return restoredPanes;

	await mapWithLimit(panesToRestore, 3, async (pane) => {
		try {
			const result = await restorePtySession({
				oldSessionId: pane.oldSessionId,
				meta: { profileId: pane.profileId, title: pane.title },
				config: {
					shell: pane.shell,
					cwd: pane.cwd,
					rows: pane.rows,
					cols: pane.cols,
					startupCommands: [],
				},
			});
			consola.info("[pty-restore] restorePtySession result", {
				oldSessionId: pane.oldSessionId,
				newSessionId: result.newSessionId,
				historyLength: result.history.length,
			});

			const history = new Uint8Array(result.history);
			if (history.length > 0) {
				sessionHistory.set(result.newSessionId, history);
			}

			restoredPanes.set(pane.oldSessionId, {
				...pane,
				newSessionId: result.newSessionId,
				history,
			});
		} catch (error) {
			consola.error(`[pty-restore] failed: ${pane.oldSessionId}`, error);
		}
	});

	return restoredPanes;
}

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
		projects.map(async (project) => ({
			project,
			sessions: await listProjectSessions({ projectId: project.id }),
		})),
	);

	const allSessions = projectSessions.flatMap(({ sessions }) => sessions);
	consola.info(`[pty-restore] found ${allSessions.length} sessions`);
	if (allSessions.length === 0) return;

	const snapshotProfiles = readTerminalLayoutSnapshot();
	const plan = buildTerminalRestorePlan(snapshotProfiles, allSessions);
	const restoredPanes = await restorePlannedPanes(plan);
	const restoredProfiles = rebuildTerminalProfilesFromRestorePlan(
		plan,
		restoredPanes,
	);

	useTerminalStore.getState().replaceProfiles(restoredProfiles);
	consola.info("[pty-restore] complete", {
		profileCount: Object.keys(restoredProfiles).length,
	});
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
