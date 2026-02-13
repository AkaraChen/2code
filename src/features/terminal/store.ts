import { QueryObserver } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import consola from "consola";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import type { ProjectWithProfiles } from "@/generated";
import {
	createPtySession,
	deletePtySessionRecord,
	getPtySessionHistory,
	listProjects,
	listProjectSessions,
} from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

enableMapSet();

interface TerminalTab {
	id: string;
	title: string;
	pendingHistory?: string;
}

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	notifiedTabs: Set<string>;
	addTab: (
		profileId: string,
		sessionId: string,
		title: string,
		pendingHistory?: string,
	) => void;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	consumeHistory: (profileId: string, tabId: string) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	removeStaleProfiles: (validIds: Set<string>) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalStore>()(
	immer((set) => ({
		profiles: {},
		notifiedTabs: new Set<string>(),

		addTab(profileId, sessionId, title, pendingHistory?) {
			set((state) => {
				const existing = state.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
					counter: 0,
				};
				const tab: TerminalTab = {
					id: sessionId,
					title,
					pendingHistory,
				};
				state.profiles[profileId] = {
					tabs: [...existing.tabs, tab],
					activeTabId: tab.id,
					counter: existing.counter + 1,
				};
			});
		},

		closeTab(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				state.notifiedTabs.delete(tabId);

				const idx = profile.tabs.findIndex((t) => t.id === tabId);
				profile.tabs = profile.tabs.filter((t) => t.id !== tabId);

				if (profile.tabs.length === 0) {
					delete state.profiles[profileId];
					return;
				}

				if (tabId === profile.activeTabId) {
					const newIdx = Math.min(idx, profile.tabs.length - 1);
					profile.activeTabId = profile.tabs[newIdx].id;
				}
			});
		},

		setActiveTab(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.activeTabId = tabId;
				state.notifiedTabs.delete(tabId);
			});
		},

		consumeHistory(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const tab = profile.tabs.find((t) => t.id === tabId);
				if (tab) delete tab.pendingHistory;
			});
		},

		removeProfile(profileId) {
			set((state) => {
				delete state.profiles[profileId];
			});
		},

		updateTabTitle(profileId, tabId, title) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const tab = profile.tabs.find((t) => t.id === tabId);
				if (tab && tab.title !== title) tab.title = title;
			});
		},

		removeStaleProfiles(validIds) {
			set((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (!validIds.has(id)) delete state.profiles[id];
				}
			});
		},

		markNotified(sessionId) {
			set((state) => {
				state.notifiedTabs.add(sessionId);
			});
		},

		markRead(sessionId) {
			set((state) => {
				state.notifiedTabs.delete(sessionId);
			});
		},
	})),
);

/** IDs of profiles that currently have terminal tabs open. */
export function useTerminalProfileIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.profiles)));
}

/** Whether a profile has any tab with an unread notification. */
export function useProfileHasNotification(profileId: string): boolean {
	return useTerminalStore((s) => {
		const profile = s.profiles[profileId];
		if (!profile) return false;
		return profile.tabs.some((t) => s.notifiedTabs.has(t.id));
	});
}

// Sync store with projects query — removes terminals for deleted profiles.
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
	useTerminalStore.getState().removeStaleProfiles(validIds);

	// One-shot terminal restoration
	if (!restored && result.data.length > 0) {
		restored = true;
		restoreTerminals(result.data);
	}
});

async function restoreTerminals(projects: ProjectWithProfiles[]) {
	consola.log(
		`[pty-restore] starting restore for ${projects.length} projects`,
	);
	const projectSessions = await Promise.all(
		projects.map(async (project) => ({
			project,
			sessions: await listProjectSessions({ projectId: project.id }),
		})),
	);

	for (const { project, sessions } of projectSessions) {
		consola.log(
			`[pty-restore] project ${project.id}: found ${sessions.length} sessions`,
			sessions.map((s) => ({
				id: s.id,
				profile: s.profile_id,
				closed: s.closed_at,
			})),
		);
	}

	let count = 0;
	await Promise.all(
		projectSessions.flatMap(({ sessions }) =>
			sessions.map(async (session) => {
				// Pre-fetch history from old session
				let historyText: string | undefined;
				try {
					consola.log(
						`[pty-restore] fetching history for old session ${session.id}`,
					);
					const history = await getPtySessionHistory({
						sessionId: session.id,
					});
					if (history.length > 0) {
						historyText = new TextDecoder().decode(
							new Uint8Array(history),
						);
						consola.log(
							`[pty-restore] fetched ${history.length} bytes of history`,
						);
					}
				} catch (e) {
					consola.warn(
						`[pty-restore] failed to fetch history for ${session.id}:`,
						e,
					);
				}

				// Delete old session record
				deletePtySessionRecord({ sessionId: session.id }).catch(
					() => {},
				);

				const newSessionId = await createPtySession({
					meta: {
						profileId: session.profile_id,
						title: session.title,
					},
					config: {
						shell: session.shell,
						cwd: session.cwd,
						rows: 24,
						cols: 80,
					},
				});
				consola.log(
					`[pty-restore] restoring session ${session.id} -> new ${newSessionId} for profile ${session.profile_id}`,
				);
				useTerminalStore
					.getState()
					.addTab(
						session.profile_id,
						newSessionId,
						session.title,
						historyText,
					);
				count++;
			}),
		),
	);
	consola.log(`[pty-restore] restore complete, ${count} sessions restored`);
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTerminalStore.getState().markNotified(event.payload);
});
