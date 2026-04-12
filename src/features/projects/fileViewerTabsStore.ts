import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import { useTerminalStore } from "@/features/terminal/store";

export interface FileViewerTab {
	filePath: string;
	title: string;
}

interface ProfileFileViewerState {
	tabs: FileViewerTab[];
	activeFilePath: string | null;
	fileTabActive: boolean;
}

interface FileViewerTabsStore {
	profiles: Record<string, ProfileFileViewerState>;
	openFile: (profileId: string, filePath: string) => void;
	closeTab: (profileId: string, filePath: string) => void;
	setFileActive: (profileId: string, filePath: string) => void;
	setTerminalActive: (profileId: string) => void;
}

export const useFileViewerTabsStore = create<FileViewerTabsStore>()(
	persist(
		immer((set) => ({
			profiles: {},

			openFile(profileId, filePath) {
				set((state) => {
					const title = filePath.split("/").pop() ?? filePath;
					const existing = state.profiles[profileId] ?? {
						tabs: [],
						activeFilePath: null,
						fileTabActive: false,
					};
					const alreadyOpen = existing.tabs.some(
						(t) => t.filePath === filePath,
					);
					state.profiles[profileId] = {
						tabs: alreadyOpen
							? existing.tabs
							: [...existing.tabs, { filePath, title }],
						activeFilePath: filePath,
						fileTabActive: true,
					};
				});
			},

			closeTab(profileId, filePath) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const idx = profile.tabs.findIndex(
						(t) => t.filePath === filePath,
					);
					profile.tabs = profile.tabs.filter(
						(t) => t.filePath !== filePath,
					);
					if (profile.activeFilePath === filePath) {
						if (profile.tabs.length > 0) {
							const newIdx = Math.min(idx, profile.tabs.length - 1);
							profile.activeFilePath = profile.tabs[newIdx].filePath;
						} else {
							profile.activeFilePath = null;
							profile.fileTabActive = false;
						}
					}
					if (profile.tabs.length === 0) {
						delete state.profiles[profileId];
					}
				});
			},

			setFileActive(profileId, filePath) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					profile.activeFilePath = filePath;
					profile.fileTabActive = true;
				});
			},

			setTerminalActive(profileId) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (profile) profile.fileTabActive = false;
				});
			},
		})),
		{ name: "file-viewer-tabs-v1" },
	),
);

function useFileViewerProfileIds() {
	return useFileViewerTabsStore(
		useShallow((s) =>
			Object.keys(s.profiles).filter(
				(id) => s.profiles[id].tabs.length > 0,
			),
		),
	);
}

/** Profiles with terminal tabs OR file viewer tabs open. Used by TerminalLayer. */
export function useActiveProfileIds() {
	const terminalIds = useTerminalStore(
		useShallow((s) => Object.keys(s.profiles)),
	);
	const fileIds = useFileViewerProfileIds();
	return useMemo(
		() => [...new Set([...terminalIds, ...fileIds])],
		[terminalIds, fileIds],
	);
}
