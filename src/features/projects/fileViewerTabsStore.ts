import { arrayMove } from "@dnd-kit/sortable";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";
import { useTerminalStore } from "@/features/terminal/store";
import { isUntitledFilePath } from "./untitledDrafts";

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
	openUntitled: (
		profileId: string,
		untitledPath: string,
		title: string,
	) => void;
	closeTab: (profileId: string, filePath: string) => void;
	renameTab: (
		profileId: string,
		oldFilePath: string,
		newFilePath: string,
		newTitle: string,
	) => void;
	reorderTabs: (profileId: string, fromIndex: number, toIndex: number) => void;
	setFileActive: (profileId: string, filePath: string) => void;
	setTerminalActive: (profileId: string) => void;
}

interface FileViewerDirtyStore {
	profiles: Record<string, string[]>;
	setFileDirty: (
		profileId: string,
		filePath: string,
		isDirty: boolean,
	) => void;
	renameDirty: (
		profileId: string,
		oldFilePath: string,
		newFilePath: string,
	) => void;
}

export const useFileViewerDirtyStore = create<FileViewerDirtyStore>()(
	immer((set) => ({
		profiles: {},

		setFileDirty(profileId, filePath, isDirty) {
			set((state) => {
				const dirtyFiles = state.profiles[profileId] ?? [];
				const alreadyDirty = dirtyFiles.includes(filePath);

				if (isDirty) {
					if (!alreadyDirty) {
						state.profiles[profileId] = [...dirtyFiles, filePath];
					}
					return;
				}

				if (!alreadyDirty) return;
				const nextDirtyFiles = dirtyFiles.filter((path) => path !== filePath);
				if (nextDirtyFiles.length > 0) {
					state.profiles[profileId] = nextDirtyFiles;
				} else {
					delete state.profiles[profileId];
				}
			});
		},

		renameDirty(profileId, oldFilePath, newFilePath) {
			if (oldFilePath === newFilePath) return;
			set((state) => {
				const dirtyFiles = state.profiles[profileId];
				if (!dirtyFiles) return;
				const idx = dirtyFiles.indexOf(oldFilePath);
				if (idx < 0) return;
				const next = [...dirtyFiles];
				next[idx] = newFilePath;
				state.profiles[profileId] = next;
			});
		},
	})),
);

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

			openUntitled(profileId, untitledPath, title) {
				set((state) => {
					const existing = state.profiles[profileId] ?? {
						tabs: [],
						activeFilePath: null,
						fileTabActive: false,
					};
					state.profiles[profileId] = {
						tabs: [...existing.tabs, { filePath: untitledPath, title }],
						activeFilePath: untitledPath,
						fileTabActive: true,
					};
				});
			},

			renameTab(profileId, oldFilePath, newFilePath, newTitle) {
				if (oldFilePath === newFilePath) return;
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find(
						(t) => t.filePath === oldFilePath,
					);
					if (!tab) return;

					const collidingIdx = profile.tabs.findIndex(
						(t) => t.filePath === newFilePath,
					);
					if (collidingIdx >= 0) {
						// A tab for the destination path already exists. Drop the
						// untitled tab and activate the existing one.
						profile.tabs = profile.tabs.filter(
							(t) => t.filePath !== oldFilePath,
						);
						profile.activeFilePath = newFilePath;
						profile.fileTabActive = true;
						return;
					}

					tab.filePath = newFilePath;
					tab.title = newTitle;
					if (profile.activeFilePath === oldFilePath) {
						profile.activeFilePath = newFilePath;
					}
				});
			},

			closeTab(profileId, filePath) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					const idx = profile.tabs.findIndex(
						(t) => t.filePath === filePath,
					);
					if (idx < 0) return;
					profile.tabs = profile.tabs.filter(
						(t) => t.filePath !== filePath,
					);
					if (profile.activeFilePath === filePath) {
						// VSCode-style focus shift: next active is the tab
						// that *was* to the right of the closed one. When the
						// closed tab was the rightmost, fall back to the new
						// rightmost (i.e., what was previously its left
						// neighbor).
						if (profile.tabs.length > 0) {
							const nextIdx = Math.min(
								idx,
								profile.tabs.length - 1,
							);
							profile.activeFilePath =
								profile.tabs[nextIdx].filePath;
						} else {
							profile.activeFilePath = null;
							profile.fileTabActive = false;
						}
					}
					if (profile.tabs.length === 0) {
						delete state.profiles[profileId];
					}
				});
				useFileViewerDirtyStore
					.getState()
					.setFileDirty(profileId, filePath, false);
			},

			reorderTabs(profileId, fromIndex, toIndex) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (
						!profile ||
						fromIndex === toIndex ||
						fromIndex < 0 ||
						toIndex < 0 ||
						fromIndex >= profile.tabs.length ||
						toIndex >= profile.tabs.length
					) {
						return;
					}
					// arrayMove handles the splice-shift correctly. Hand-rolled
					// `splice(from, 1)` then `splice(to, 0, item)` is off by
					// one when from < to because the removal shifts everything
					// left before the insertion runs.
					profile.tabs = arrayMove(profile.tabs, fromIndex, toIndex);
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
		{
			name: "file-viewer-tabs-v1",
			// Untitled drafts only live in memory — drop them from the
			// persisted snapshot so they don't ghost-restore as broken tabs.
			partialize: (state) => ({
				profiles: Object.fromEntries(
					(
						Object.entries(state.profiles) as Array<
							[string, ProfileFileViewerState]
						>
					)
						.map(([profileId, profile]) => {
							const persistedTabs = profile.tabs.filter(
								(tab) => !isUntitledFilePath(tab.filePath),
							);
							const wasActiveUntitled =
								profile.activeFilePath != null &&
								isUntitledFilePath(profile.activeFilePath);
							const nextProfile: ProfileFileViewerState = {
								...profile,
								tabs: persistedTabs,
								activeFilePath: wasActiveUntitled
									? (persistedTabs[persistedTabs.length - 1]
											?.filePath ?? null)
									: profile.activeFilePath,
								fileTabActive:
									persistedTabs.length > 0 &&
									profile.fileTabActive,
							};
							return [profileId, nextProfile] as const;
						})
						.filter(([, profile]) => profile.tabs.length > 0),
				),
			}),
		},
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
