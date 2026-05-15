import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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

interface FileViewerDirtyStore {
	profiles: Record<string, string[]>;
	setFileDirty: (
		profileId: string,
		filePath: string,
		isDirty: boolean,
	) => void;
}

const EMPTY_PROFILE_FILE_VIEWER_STATE: ProfileFileViewerState = {
	tabs: [],
	activeFilePath: null,
	fileTabActive: false,
};

export function setFileDirtyState(
	profiles: Record<string, string[]>,
	profileId: string,
	filePath: string,
	isDirty: boolean,
) {
	const dirtyFiles = profiles[profileId] ?? [];
	const alreadyDirty = dirtyFiles.includes(filePath);

	if (isDirty) {
		if (alreadyDirty) return profiles;
		return {
			...profiles,
			[profileId]: [...dirtyFiles, filePath],
		};
	}

	if (!alreadyDirty) return profiles;
	const nextDirtyFiles = dirtyFiles.filter((path) => path !== filePath);
	if (nextDirtyFiles.length > 0) {
		return {
			...profiles,
			[profileId]: nextDirtyFiles,
		};
	}

	const nextProfiles = { ...profiles };
	delete nextProfiles[profileId];
	return nextProfiles;
}

export function openFileState(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
	filePath: string,
) {
	const title = filePath.split("/").pop() ?? filePath;
	const existing = profiles[profileId] ?? EMPTY_PROFILE_FILE_VIEWER_STATE;
	const alreadyOpen = existing.tabs.some((t) => t.filePath === filePath);
	return {
		...profiles,
		[profileId]: {
			tabs: alreadyOpen
				? existing.tabs
				: [...existing.tabs, { filePath, title }],
			activeFilePath: filePath,
			fileTabActive: true,
		},
	};
}

export function closeTabState(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
	filePath: string,
) {
	const profile = profiles[profileId];
	if (!profile) return profiles;

	const idx = profile.tabs.findIndex((t) => t.filePath === filePath);
	if (idx === -1) return profiles;

	const tabs = profile.tabs.filter((t) => t.filePath !== filePath);
	if (tabs.length === 0) {
		const nextProfiles = { ...profiles };
		delete nextProfiles[profileId];
		return nextProfiles;
	}

	const nextProfile = { ...profile, tabs };
	if (profile.activeFilePath === filePath) {
		const newIdx = Math.min(idx, tabs.length - 1);
		nextProfile.activeFilePath = tabs[newIdx].filePath;
	}

	return {
		...profiles,
		[profileId]: nextProfile,
	};
}

export function setFileActiveState(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
	filePath: string,
) {
	const profile = profiles[profileId];
	if (!profile) return profiles;
	return {
		...profiles,
		[profileId]: {
			...profile,
			activeFilePath: filePath,
			fileTabActive: true,
		},
	};
}

export function setTerminalActiveState(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
) {
	const profile = profiles[profileId];
	if (!profile || !profile.fileTabActive) return profiles;
	return {
		...profiles,
		[profileId]: {
			...profile,
			fileTabActive: false,
		},
	};
}

export const useFileViewerDirtyStore = create<FileViewerDirtyStore>()((set) => ({
	profiles: {},

	setFileDirty(profileId, filePath, isDirty) {
		set((state) => ({
			profiles: setFileDirtyState(
				state.profiles,
				profileId,
				filePath,
				isDirty,
			),
		}));
	},
}));

export const useFileViewerTabsStore = create<FileViewerTabsStore>()(
	persist(
		(set) => ({
			profiles: {},

			openFile(profileId, filePath) {
				set((state) => ({
					profiles: openFileState(
						state.profiles,
						profileId,
						filePath,
					),
				}));
			},

			closeTab(profileId, filePath) {
				set((state) => ({
					profiles: closeTabState(
						state.profiles,
						profileId,
						filePath,
					),
				}));
				useFileViewerDirtyStore
					.getState()
					.setFileDirty(profileId, filePath, false);
			},

			setFileActive(profileId, filePath) {
				set((state) => ({
					profiles: setFileActiveState(
						state.profiles,
						profileId,
						filePath,
					),
				}));
			},

			setTerminalActive(profileId) {
				set((state) => ({
					profiles: setTerminalActiveState(state.profiles, profileId),
				}));
			},
		}),
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
