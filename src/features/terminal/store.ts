import { create as createMutative, type Draft } from "mutative";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

interface TerminalTab {
	id: string;
	title: string;
}

export type AgentStatus = "running" | "waiting";
export type AgentStatusUpdate = AgentStatus | "idle";
export type AgentCompletionNotification = "completed";

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

function findProfileIdBySessionId(
	profiles: Record<string, ProjectTerminalState>,
	sessionId: string,
): string | null {
	for (const [profileId, profile] of Object.entries(profiles)) {
		if (profile.tabs.some((tab) => tab.id === sessionId)) {
			return profileId;
		}
	}

	return null;
}

function refreshSessionProfileId(
	state: Pick<TerminalStore, "profiles" | "sessionProfileIds">,
	sessionId: string,
) {
	const profileId = findProfileIdBySessionId(state.profiles, sessionId);
	if (profileId) {
		state.sessionProfileIds[sessionId] = profileId;
	} else {
		delete state.sessionProfileIds[sessionId];
	}
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	agentStatuses: Record<string, AgentStatus>;
	agentCompletions: Record<string, AgentCompletionNotification>;
	sessionProfileIds: Record<string, string>;
	addTab: (profileId: string, sessionId: string, title: string) => void;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
	removeStaleProfiles: (validIds: Set<string>) => void;
	setAgentStatus: (sessionId: string, status: AgentStatusUpdate) => void;
	clearAgentStatus: (sessionId: string) => void;
	dismissAgentCompletion: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalStore>()((set) => {
	const mutate = (recipe: (state: Draft<TerminalStore>) => void) => {
		set((state) => createMutative(state, recipe));
	};

	return {
		profiles: {},
		agentStatuses: {},
		agentCompletions: {},
		sessionProfileIds: {},

		addTab(profileId, sessionId, title) {
			mutate((state) => {
				const existing = state.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
					counter: 0,
				};
				const tab: TerminalTab = { id: sessionId, title };
				state.profiles[profileId] = {
					tabs: [...existing.tabs, tab],
					activeTabId: tab.id,
					counter: existing.counter + 1,
				};
				state.sessionProfileIds[sessionId] ??= profileId;
			});
		},

		closeTab(profileId, tabId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const wasActiveTab = tabId === profile.activeTabId;

				delete state.agentStatuses[tabId];
				delete state.agentCompletions[tabId];

				const idx = profile.tabs.findIndex((t) => t.id === tabId);
				profile.tabs = profile.tabs.filter((t) => t.id !== tabId);
				refreshSessionProfileId(state, tabId);

				if (profile.tabs.length === 0) {
					delete state.profiles[profileId];
					return;
				}

				if (wasActiveTab) {
					const newIdx = Math.min(idx, profile.tabs.length - 1);
					profile.activeTabId = profile.tabs[newIdx].id;
				}
			});
		},

		setActiveTab(profileId, tabId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.activeTabId = tabId;
			});
		},

		removeProfile(profileId) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				profile?.tabs.forEach((tab) => {
					delete state.agentStatuses[tab.id];
					delete state.agentCompletions[tab.id];
				});
				delete state.profiles[profileId];
				profile?.tabs.forEach((tab) =>
					refreshSessionProfileId(state, tab.id),
				);
			});
		},

		updateTabTitle(profileId, tabId, title) {
			mutate((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const tab = profile.tabs.find((t) => t.id === tabId);
				if (tab && tab.title !== title) tab.title = title;
			});
		},

		removeStaleProfiles(validIds) {
			mutate((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (!validIds.has(id)) {
						state.profiles[id].tabs.forEach((tab) => {
							delete state.agentStatuses[tab.id];
							delete state.agentCompletions[tab.id];
						});
						const removedSessionIds = state.profiles[id].tabs.map(
							(tab) => tab.id,
						);
						delete state.profiles[id];
						removedSessionIds.forEach((sessionId) =>
							refreshSessionProfileId(state, sessionId),
						);
					}
				}
			});
		},

		setAgentStatus(sessionId, status) {
			mutate((state) => {
				if (status === "idle") {
					if (state.agentStatuses[sessionId] === "running") {
						state.agentCompletions[sessionId] = "completed";
					}
					if (!state.agentStatuses[sessionId]) return;
					delete state.agentStatuses[sessionId];
					return;
				}

				delete state.agentCompletions[sessionId];
				if (state.agentStatuses[sessionId] === status) return;
				state.agentStatuses[sessionId] = status;
			});
		},

		clearAgentStatus(sessionId) {
			mutate((state) => {
				delete state.agentStatuses[sessionId];
			});
		},

		dismissAgentCompletion(sessionId) {
			mutate((state) => {
				delete state.agentCompletions[sessionId];
			});
		},
	};
});

/** IDs of profiles that currently have terminal tabs open. */
export function useTerminalProfileIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.profiles)));
}

function getProfileAgentStatus(
	state: Pick<TerminalStore, "profiles" | "agentStatuses">,
	profileId: string,
): AgentStatus | null {
	const profile = state.profiles[profileId];
	if (!profile) return null;

	let hasRunning = false;
	for (const tab of profile.tabs) {
		const status = state.agentStatuses[tab.id];
		if (status === "waiting") return "waiting";
		if (status === "running") hasRunning = true;
	}

	return hasRunning ? "running" : null;
}

function getProfileAgentCompletion(
	state: Pick<TerminalStore, "profiles" | "agentCompletions">,
	profileId: string,
): AgentCompletionNotification | null {
	const profile = state.profiles[profileId];
	if (!profile) return null;

	return profile.tabs.some((tab) => state.agentCompletions[tab.id])
		? "completed"
		: null;
}

/** The highest-priority agent status among a profile's terminal tabs. */
export function useProfileAgentStatus(profileId: string): AgentStatus | null {
	return useTerminalStore((s) => {
		return getProfileAgentStatus(s, profileId);
	});
}

/** Whether any tab in a profile has a dismissed-on-click completion notification. */
export function useProfileAgentCompletion(profileId: string): AgentCompletionNotification | null {
	return useTerminalStore((s) => {
		return getProfileAgentCompletion(s, profileId);
	});
}

/** Whether a profile has any active agent status. */
export function useProfileHasNotification(profileId: string): boolean {
	return useTerminalStore(
		(s) =>
			getProfileAgentStatus(s, profileId) !== null
			|| getProfileAgentCompletion(s, profileId) !== null,
	);
}
