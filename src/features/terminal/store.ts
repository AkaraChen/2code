import { QueryObserver } from "@tanstack/react-query";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import type { ProjectWithProfiles } from "@/generated";
import { listProjects } from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

interface TerminalTab {
	id: string;
	title: string;
	restoreFrom?: string;
}

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalStore {
	profiles: Record<string, ProjectTerminalState>;
	addTab(
		profileId: string,
		sessionId: string,
		title: string,
		restoreFrom?: string,
	): void;
	closeTab(profileId: string, tabId: string): void;
	setActiveTab(profileId: string, tabId: string): void;
	clearRestore(profileId: string, tabId: string): void;
	removeProfile(profileId: string): void;
	updateTabTitle(profileId: string, tabId: string, title: string): void;
	removeStaleProfiles(validIds: Set<string>): void;
}

export const useTerminalStore = create<TerminalStore>()(
	immer((set) => ({
		profiles: {},

		addTab(profileId, sessionId, title, restoreFrom?) {
			set((state) => {
				const existing = state.profiles[profileId] ?? {
					tabs: [],
					activeTabId: null,
					counter: 0,
				};
				const tab: TerminalTab = { id: sessionId, title, restoreFrom };
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
			});
		},

		clearRestore(profileId, tabId) {
			set((state) => {
				const profile = state.profiles[profileId];
				if (!profile) return;
				const tab = profile.tabs.find((t) => t.id === tabId);
				if (tab) delete tab.restoreFrom;
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
	})),
);

/** IDs of profiles that currently have terminal tabs open. */
export function useTerminalProfileIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.profiles)));
}

// Sync store with projects query — removes terminals for deleted profiles.
const observer = new QueryObserver<ProjectWithProfiles[]>(queryClient, {
	queryKey: queryKeys.projects.all,
	queryFn: listProjects,
});

observer.subscribe((result) => {
	if (result.data) {
		const validIds = new Set(
			result.data.flatMap((p) => p.profiles.map((pr) => pr.id)),
		);
		useTerminalStore.getState().removeStaleProfiles(validIds);
	}
});
