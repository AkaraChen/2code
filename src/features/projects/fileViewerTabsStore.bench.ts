import { produce } from "immer";
import { bench, describe } from "vitest";
import {
	closeTabState,
	openFileState,
	setFileDirtyState,
	type FileViewerTab,
} from "./fileViewerTabsStore";

interface ProfileFileViewerState {
	tabs: FileViewerTab[];
	activeFilePath: string | null;
	fileTabActive: boolean;
}

function createTabProfiles(profileCount: number, tabCount: number) {
	const profiles: Record<string, ProfileFileViewerState> = {};
	for (let profileIndex = 0; profileIndex < profileCount; profileIndex += 1) {
		const profileId = `profile-${profileIndex}`;
		profiles[profileId] = {
			tabs: Array.from({ length: tabCount }, (_item, tabIndex) => ({
				filePath: `/repo-${profileIndex}/src/file-${tabIndex}.tsx`,
				title: `file-${tabIndex}.tsx`,
			})),
			activeFilePath: `/repo-${profileIndex}/src/file-${tabCount - 1}.tsx`,
			fileTabActive: true,
		};
	}
	return profiles;
}

function createDirtyProfiles(profileCount: number, fileCount: number) {
	const profiles: Record<string, string[]> = {};
	for (let profileIndex = 0; profileIndex < profileCount; profileIndex += 1) {
		profiles[`profile-${profileIndex}`] = Array.from(
			{ length: fileCount },
			(_item, fileIndex) => `/repo-${profileIndex}/src/file-${fileIndex}.tsx`,
		);
	}
	return profiles;
}

function openFileWithImmer(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
	filePath: string,
) {
	return produce(profiles, (draft) => {
		const title = filePath.split("/").pop() ?? filePath;
		const existing = draft[profileId] ?? {
			tabs: [],
			activeFilePath: null,
			fileTabActive: false,
		};
		const alreadyOpen = existing.tabs.some((t) => t.filePath === filePath);
		draft[profileId] = {
			tabs: alreadyOpen ? existing.tabs : [...existing.tabs, { filePath, title }],
			activeFilePath: filePath,
			fileTabActive: true,
		};
	});
}

function closeTabWithImmer(
	profiles: Record<string, ProfileFileViewerState>,
	profileId: string,
	filePath: string,
) {
	return produce(profiles, (draft) => {
		const profile = draft[profileId];
		if (!profile) return;
		const idx = profile.tabs.findIndex((t) => t.filePath === filePath);
		profile.tabs = profile.tabs.filter((t) => t.filePath !== filePath);
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
			delete draft[profileId];
		}
	});
}

function setFileDirtyWithImmer(
	profiles: Record<string, string[]>,
	profileId: string,
	filePath: string,
	isDirty: boolean,
) {
	return produce(profiles, (draft) => {
		const dirtyFiles = draft[profileId] ?? [];
		const alreadyDirty = dirtyFiles.includes(filePath);

		if (isDirty) {
			if (!alreadyDirty) {
				draft[profileId] = [...dirtyFiles, filePath];
			}
			return;
		}

		if (!alreadyDirty) return;
		const nextDirtyFiles = dirtyFiles.filter((path) => path !== filePath);
		if (nextDirtyFiles.length > 0) {
			draft[profileId] = nextDirtyFiles;
		} else {
			delete draft[profileId];
		}
	});
}

describe("fileViewerTabsStore reducers", () => {
	const tabProfiles = createTabProfiles(200, 24);
	const dirtyProfiles = createDirtyProfiles(200, 24);

	bench("immer open and close tab", () => {
		const opened = openFileWithImmer(
			tabProfiles,
			"profile-100",
			"/repo-100/src/new-file.tsx",
		);
		closeTabWithImmer(opened, "profile-100", "/repo-100/src/file-12.tsx");
	});

	bench("plain open and close tab", () => {
		const opened = openFileState(
			tabProfiles,
			"profile-100",
			"/repo-100/src/new-file.tsx",
		);
		closeTabState(opened, "profile-100", "/repo-100/src/file-12.tsx");
	});

	bench("immer update dirty files", () => {
		const added = setFileDirtyWithImmer(
			dirtyProfiles,
			"profile-100",
			"/repo-100/src/new-file.tsx",
			true,
		);
		setFileDirtyWithImmer(
			added,
			"profile-100",
			"/repo-100/src/file-12.tsx",
			false,
		);
	});

	bench("plain update dirty files", () => {
		const added = setFileDirtyState(
			dirtyProfiles,
			"profile-100",
			"/repo-100/src/new-file.tsx",
			true,
		);
		setFileDirtyState(
			added,
			"profile-100",
			"/repo-100/src/file-12.tsx",
			false,
		);
	});
});
