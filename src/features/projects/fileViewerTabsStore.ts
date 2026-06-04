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
	notesActive: boolean;
}

interface FileViewerTabsStore {
	profiles: Record<string, ProfileFileViewerState>;
	openFile: (profileId: string, filePath: string) => void;
	closeTab: (profileId: string, filePath: string) => void;
	setFileActive: (profileId: string, filePath: string) => void;
	setNotesActive: (profileId: string) => void;
	setTerminalActive: (profileId: string) => void;
}

interface FileViewerDirtyStore {
	profiles: Record<string, string[]>;
	drafts: Record<string, Record<string, string>>;
	savedValues: Record<string, Record<string, string>>;
	setFileDraft: (
		profileId: string,
		filePath: string,
		content: string,
	) => void;
	setFileSavedValue: (
		profileId: string,
		filePath: string,
		content: string,
	) => void;
	setFileDirty: (
		profileId: string,
		filePath: string,
		isDirty: boolean,
	) => void;
	clearFileState: (profileId: string, filePath: string) => void;
}

export const useFileViewerDirtyStore = create<FileViewerDirtyStore>()(
	immer((set) => ({
		profiles: {},
		drafts: {},
		savedValues: {},

		setFileDraft(profileId, filePath, content) {
			set((state) => {
				state.drafts[profileId] ??= {};
				state.drafts[profileId][filePath] = content;
			});
		},

		setFileSavedValue(profileId, filePath, content) {
			set((state) => {
				state.savedValues[profileId] ??= {};
				state.savedValues[profileId][filePath] = content;
			});
		},

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

		clearFileState(profileId, filePath) {
			set((state) => {
				const dirtyFiles = state.profiles[profileId] ?? [];
				const nextDirtyFiles = dirtyFiles.filter((path) => path !== filePath);
				if (nextDirtyFiles.length > 0) {
					state.profiles[profileId] = nextDirtyFiles;
				} else {
					delete state.profiles[profileId];
				}

				if (state.drafts[profileId]) {
					delete state.drafts[profileId][filePath];
					if (Object.keys(state.drafts[profileId]).length === 0) {
						delete state.drafts[profileId];
					}
				}

				if (state.savedValues[profileId]) {
					delete state.savedValues[profileId][filePath];
					if (Object.keys(state.savedValues[profileId]).length === 0) {
						delete state.savedValues[profileId];
					}
				}
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
						notesActive: false,
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
						notesActive: false,
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
					if (profile.tabs.length === 0 && !profile.notesActive) {
						delete state.profiles[profileId];
					}
				});
				useFileViewerDirtyStore
					.getState()
					.clearFileState(profileId, filePath);
			},

			setFileActive(profileId, filePath) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					profile.activeFilePath = filePath;
					profile.fileTabActive = true;
					profile.notesActive = false;
				});
			},

			setNotesActive(profileId) {
				set((state) => {
					const existing = state.profiles[profileId] ?? {
						tabs: [],
						activeFilePath: null,
						fileTabActive: false,
						notesActive: false,
					};
					state.profiles[profileId] = {
						...existing,
						fileTabActive: false,
						notesActive: true,
					};
				});
			},

			setTerminalActive(profileId) {
				set((state) => {
					const profile = state.profiles[profileId];
					if (!profile) return;
					profile.fileTabActive = false;
					profile.notesActive = false;
					if (profile.tabs.length === 0) delete state.profiles[profileId];
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
				(id) => s.profiles[id].tabs.length > 0 || s.profiles[id].notesActive,
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
