import { listen } from "@tauri-apps/api/event";
import { enableMapSet } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";

enableMapSet();

const TERMINAL_LAYOUT_STORAGE_KEY = "terminal-layout-v1";

export type TerminalSplitDirection = "horizontal" | "vertical";

export interface TerminalPane {
	sessionId: string;
	title: string;
	cwd: string;
	shell: string;
}

export interface TerminalTab {
	id: string;
	title: string;
	activePaneId: string;
	primaryPaneId: string;
	direction: TerminalSplitDirection | null;
	panes: TerminalPane[];
}

export interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

export interface TerminalLayoutSnapshot {
	version: 1;
	profiles: Record<string, ProjectTerminalState>;
}

interface TerminalPanePayload {
	sessionId: string;
	title: string;
	cwd: string;
	shell: string;
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	notifiedTabs: Set<string>;
	addTab: (
		profileId: string,
		sessionId: string,
		title: string,
		cwd: string,
		shell: string,
	) => void;
	splitTab: (
		profileId: string,
		tabId: string,
		direction: TerminalSplitDirection,
		pane: TerminalPanePayload,
	) => void;
	closeTab: (profileId: string, tabId: string) => void;
	closePane: (profileId: string, tabId: string, sessionId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	setActivePane: (
		profileId: string,
		tabId: string,
		sessionId: string,
	) => void;
	replaceProfiles: (profiles: Record<string, ProjectTerminalState>) => void;
	removeProfile: (profileId: string) => void;
	updateTabTitle: (profileId: string, sessionId: string, title: string) => void;
	removeStaleProfiles: (validIds: Set<string>) => void;
	markNotified: (sessionId: string) => void;
	markRead: (sessionId: string) => void;
	markProfileRead: (profileId: string) => void;
}

function getLayoutStorage() {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

function serializePane(pane: TerminalPane): TerminalPane {
	return {
		sessionId: pane.sessionId,
		title: pane.title,
		cwd: pane.cwd,
		shell: pane.shell,
	};
}

function serializeTab(tab: TerminalTab): TerminalTab {
	return {
		id: tab.id,
		title: tab.title,
		activePaneId: tab.activePaneId,
		primaryPaneId: tab.primaryPaneId,
		direction: tab.direction,
		panes: tab.panes.map(serializePane),
	};
}

function serializeProfiles(
	profiles: Record<string, ProjectTerminalState>,
): Record<string, ProjectTerminalState> {
	return Object.fromEntries(
		Object.entries(profiles).map(([profileId, profile]) => [
			profileId,
			{
				tabs: profile.tabs.map(serializeTab),
				activeTabId: profile.activeTabId,
				counter: profile.counter,
			},
		]),
	);
}

function normalizePane(input: unknown): TerminalPane | null {
	if (!input || typeof input !== "object") return null;
	const candidate = input as Partial<TerminalPane>;
	if (
		typeof candidate.sessionId !== "string"
		|| typeof candidate.title !== "string"
		|| typeof candidate.cwd !== "string"
		|| typeof candidate.shell !== "string"
	) {
		return null;
	}
	return serializePane(candidate as TerminalPane);
}

function normalizeTab(input: unknown): TerminalTab | null {
	if (!input || typeof input !== "object") return null;

	const candidate = input as Partial<TerminalTab>;
	if (
		typeof candidate.id !== "string"
		|| typeof candidate.title !== "string"
		|| !Array.isArray(candidate.panes)
	) {
		return null;
	}

	const panes = candidate.panes
		.map(normalizePane)
		.filter((pane): pane is TerminalPane => pane !== null)
		.slice(0, 2);
	if (panes.length === 0) return null;

	const primaryPaneId =
		typeof candidate.primaryPaneId === "string"
		&& panes.some((pane) => pane.sessionId === candidate.primaryPaneId)
			? candidate.primaryPaneId
			: panes[0].sessionId;
	const activePaneId =
		typeof candidate.activePaneId === "string"
		&& panes.some((pane) => pane.sessionId === candidate.activePaneId)
			? candidate.activePaneId
			: panes[panes.length - 1].sessionId;

	return {
		id: candidate.id,
		title: candidate.title,
		activePaneId,
		primaryPaneId,
		direction:
			panes.length > 1
				&& (candidate.direction === "horizontal"
					|| candidate.direction === "vertical")
				? candidate.direction
				: null,
		panes,
	};
}

function normalizeProfiles(
	profiles: unknown,
): Record<string, ProjectTerminalState> {
	if (!profiles || typeof profiles !== "object") return {};

	const normalized: Record<string, ProjectTerminalState> = {};
	for (const [profileId, profile] of Object.entries(profiles)) {
		if (!profile || typeof profile !== "object") continue;

		const candidate = profile as Partial<ProjectTerminalState>;
		if (!Array.isArray(candidate.tabs)) continue;

		const tabs = candidate.tabs
			.map(normalizeTab)
			.filter((tab): tab is TerminalTab => tab !== null);
		if (tabs.length === 0) continue;

		const activeTabId =
			typeof candidate.activeTabId === "string"
			&& tabs.some((tab) => tab.id === candidate.activeTabId)
				? candidate.activeTabId
				: tabs[0].id;
		const counter =
			typeof candidate.counter === "number" && Number.isFinite(candidate.counter)
				? Math.max(Math.round(candidate.counter), tabs.length)
				: tabs.length;

		normalized[profileId] = {
			tabs,
			activeTabId,
			counter,
		};
	}

	return normalized;
}

export function readTerminalLayoutSnapshot(): Record<string, ProjectTerminalState> {
	const storage = getLayoutStorage();
	if (!storage) return {};

	const raw = storage.getItem(TERMINAL_LAYOUT_STORAGE_KEY);
	if (!raw) return {};

	try {
		const parsed = JSON.parse(raw) as Partial<TerminalLayoutSnapshot>;
		if (parsed.version !== 1) return {};
		return normalizeProfiles(parsed.profiles);
	} catch {
		return {};
	}
}

function persistTerminalLayoutSnapshot(
	profiles: Record<string, ProjectTerminalState>,
) {
	const storage = getLayoutStorage();
	if (!storage) return;

	if (Object.keys(profiles).length === 0) {
		storage.removeItem(TERMINAL_LAYOUT_STORAGE_KEY);
		return;
	}

	const snapshot: TerminalLayoutSnapshot = {
		version: 1,
		profiles: serializeProfiles(profiles),
	};
	storage.setItem(TERMINAL_LAYOUT_STORAGE_KEY, JSON.stringify(snapshot));
}

function createPane(payload: TerminalPanePayload): TerminalPane {
	return {
		sessionId: payload.sessionId,
		title: payload.title,
		cwd: payload.cwd,
		shell: payload.shell,
	};
}

function clearTabNotifications(
	notifiedTabs: Set<string>,
	tab: TerminalTab | undefined,
) {
	tab?.panes.forEach((pane) => notifiedTabs.delete(pane.sessionId));
}

export const useTerminalStore = create<TerminalStore>()(
	immer((set) => ({
		profiles: {},
		notifiedTabs: new Set<string>(),

		addTab(profileId, sessionId, title, cwd, shell) {
			set((state) => {
				const existing = state.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
					counter: 0,
				};
				const pane = createPane({ sessionId, title, cwd, shell });
				const tab: TerminalTab = {
					id: sessionId,
					title,
					activePaneId: sessionId,
					primaryPaneId: sessionId,
					direction: null,
					panes: [pane],
				};
				state.profiles[profileId] = {
					tabs: [...existing.tabs, tab],
					activeTabId: tab.id,
					counter: existing.counter + 1,
				};
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		splitTab(profileId, tabId, direction, panePayload) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				const tab = profile.tabs.find((candidate) => candidate.id === tabId);
				if (!tab || tab.panes.length >= 2) return;
				if (
					tab.panes.some(
						(existingPane) =>
							existingPane.sessionId === panePayload.sessionId,
					)
				) {
					return;
				}

				tab.panes.push(createPane(panePayload));
				tab.direction = direction;
				tab.activePaneId = panePayload.sessionId;
				profile.activeTabId = tabId;
				profile.counter += 1;
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		closeTab(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				const idx = profile.tabs.findIndex((tab) => tab.id === tabId);
				if (idx === -1) return;

				clearTabNotifications(state.notifiedTabs, profile.tabs[idx]);
				profile.tabs.splice(idx, 1);

				if (profile.tabs.length === 0) {
					delete state.profiles[profileId];
					persistTerminalLayoutSnapshot(state.profiles);
					return;
				}

				if (tabId === profile.activeTabId) {
					const newIdx = Math.min(idx, profile.tabs.length - 1);
					profile.activeTabId = profile.tabs[newIdx].id;
				}
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		closePane(profileId, tabId, sessionId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				const tabIndex = profile.tabs.findIndex((tab) => tab.id === tabId);
				if (tabIndex === -1) return;

				const tab = profile.tabs[tabIndex];
				const paneIndex = tab.panes.findIndex(
					(pane) => pane.sessionId === sessionId,
				);
				if (paneIndex === -1) return;

				state.notifiedTabs.delete(sessionId);
				tab.panes.splice(paneIndex, 1);

				if (tab.panes.length === 0) {
					profile.tabs.splice(tabIndex, 1);
					if (profile.tabs.length === 0) {
						delete state.profiles[profileId];
						persistTerminalLayoutSnapshot(state.profiles);
						return;
					}
					if (profile.activeTabId === tabId) {
						const nextTabIndex = Math.min(
							tabIndex,
							profile.tabs.length - 1,
						);
						profile.activeTabId = profile.tabs[nextTabIndex].id;
					}
					persistTerminalLayoutSnapshot(state.profiles);
					return;
				}

				if (tab.activePaneId === sessionId) {
					const nextPaneIndex = Math.min(
						paneIndex,
						tab.panes.length - 1,
					);
					tab.activePaneId = tab.panes[nextPaneIndex].sessionId;
				}

				if (tab.primaryPaneId === sessionId) {
					tab.primaryPaneId = tab.panes[0].sessionId;
					tab.title = tab.panes[0].title;
				}

				if (tab.panes.length === 1) {
					tab.direction = null;
					tab.activePaneId = tab.panes[0].sessionId;
				}
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		setActiveTab(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				const tab = profile.tabs.find((candidate) => candidate.id === tabId);
				if (!tab) return;

				profile.activeTabId = tabId;
				clearTabNotifications(state.notifiedTabs, tab);
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		setActivePane(profileId, tabId, sessionId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				const tab = profile.tabs.find((candidate) => candidate.id === tabId);
				if (!tab) return;
				if (!tab.panes.some((pane) => pane.sessionId === sessionId)) return;

				profile.activeTabId = tabId;
				tab.activePaneId = sessionId;
				state.notifiedTabs.delete(sessionId);
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		replaceProfiles(profiles) {
			set((state) => {
				state.profiles = serializeProfiles(profiles);
				state.notifiedTabs = new Set<string>();
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		removeProfile(profileId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (profile) {
					profile.tabs.forEach((tab) =>
						clearTabNotifications(state.notifiedTabs, tab),
					);
				}
				delete state.profiles[profileId];
				persistTerminalLayoutSnapshot(state.profiles);
			});
		},

		updateTabTitle(profileId, sessionId, title) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;

				for (const tab of profile.tabs) {
					const pane = tab.panes.find(
						(candidate) => candidate.sessionId === sessionId,
					);
					if (!pane || pane.title === title) continue;
					pane.title = title;
					if (tab.primaryPaneId === sessionId) {
						tab.title = title;
					}
					persistTerminalLayoutSnapshot(state.profiles);
					return;
				}
			});
		},

		removeStaleProfiles(validIds) {
			set((state) => {
				for (const id of Object.keys(state.profiles)) {
					if (validIds.has(id)) continue;
					const profile = state.profiles[id];
					profile.tabs.forEach((tab) =>
						clearTabNotifications(state.notifiedTabs, tab),
					);
					delete state.profiles[id];
				}
				persistTerminalLayoutSnapshot(state.profiles);
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

		markProfileRead(profileId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				profile.tabs.forEach((tab) =>
					clearTabNotifications(state.notifiedTabs, tab),
				);
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
		return profile.tabs.some((tab) =>
			tab.panes.some((pane) => s.notifiedTabs.has(pane.sessionId)),
		);
	});
}

// Module-level listener for notification events from the backend
listen<string>("pty-notify", (event) => {
	useTerminalStore.getState().markNotified(event.payload);
});
