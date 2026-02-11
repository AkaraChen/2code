import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo } from "react";

interface TerminalTab {
	id: string;
	title: string;
}

interface ProjectTerminalState {
	tabs: TerminalTab[];
	activeTabId: string | null;
	counter: number;
}

interface TerminalStore {
	projects: Record<string, ProjectTerminalState>;
	addTab(projectId: string, sessionId: string, title: string): void;
	closeTab(projectId: string, tabId: string): void;
	setActiveTab(projectId: string, tabId: string): void;
	removeProject(projectId: string): void;
	removeStaleProjects(validIds: Set<string>): void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
	projects: {},

	addTab(projectId, sessionId, title) {
		set((state) => {
			const existing = state.projects[projectId] ?? {
				tabs: [],
				activeTabId: null,
				counter: 0,
			};
			const tab: TerminalTab = { id: sessionId, title };
			return {
				projects: {
					...state.projects,
					[projectId]: {
						tabs: [...existing.tabs, tab],
						activeTabId: tab.id,
						counter: existing.counter + 1,
					},
				},
			};
		});
	},

	closeTab(projectId, tabId) {
		set((state) => {
			const project = state.projects[projectId];
			if (!project) return state;

			const idx = project.tabs.findIndex((t) => t.id === tabId);
			const next = project.tabs.filter((t) => t.id !== tabId);

			if (next.length === 0) {
				const { [projectId]: _, ...rest } = state.projects;
				return { projects: rest };
			}

			let activeTabId = project.activeTabId;
			if (tabId === activeTabId) {
				const newIdx = Math.min(idx, next.length - 1);
				activeTabId = next[newIdx].id;
			}

			return {
				projects: {
					...state.projects,
					[projectId]: {
						...project,
						tabs: next,
						activeTabId,
					},
				},
			};
		});
	},

	setActiveTab(projectId, tabId) {
		set((state) => {
			const project = state.projects[projectId];
			if (!project) return state;
			return {
				projects: {
					...state.projects,
					[projectId]: { ...project, activeTabId: tabId },
				},
			};
		});
	},

	removeProject(projectId) {
		set((state) => {
			if (!(projectId in state.projects)) return state;
			const { [projectId]: _, ...rest } = state.projects;
			return { projects: rest };
		});
	},

	removeStaleProjects(validIds) {
		set((state) => {
			const staleKeys = Object.keys(state.projects).filter(
				(id) => !validIds.has(id),
			);
			if (staleKeys.length === 0) return state;
			const next = { ...state.projects };
			for (const key of staleKeys) {
				delete next[key];
			}
			return { projects: next };
		});
	},
}));

/** IDs of projects that currently have terminal tabs open. */
export function useTerminalProjectIds() {
	return useTerminalStore(useShallow((s) => Object.keys(s.projects)));
}

/** Sync store with project list — removes terminals for deleted projects. */
export function useTerminalSync(projects: { id: string }[]) {
	const removeStaleProjects = useTerminalStore((s) => s.removeStaleProjects);
	const validIds = useMemo(
		() => new Set(projects.map((p) => p.id)),
		[projects],
	);
	useEffect(() => {
		removeStaleProjects(validIds);
	}, [validIds, removeStaleProjects]);
}
