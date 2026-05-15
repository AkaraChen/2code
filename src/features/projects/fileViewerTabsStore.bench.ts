import { bench, describe } from "vitest";
import {
	closeFileViewerTab,
	type ProfileFileViewerState,
	updateDirtyFileList,
} from "./fileViewerTabsStore";

const tabs = Array.from({ length: 5_000 }, (_, index) => ({
	filePath: `/repo/src/file-${index}.ts`,
	title: `file-${index}.ts`,
}));
const targetPath = tabs[3_750].filePath;
const dirtyFiles = Array.from(
	{ length: 5_000 },
	(_, index) => `/repo/src/file-${index}.ts`,
);
const dirtyTargetPath = dirtyFiles[3_750];
let sink = 0;

function makeProfile(): ProfileFileViewerState {
	return {
		tabs: tabs.map((tab) => ({ ...tab })),
		activeFilePath: targetPath,
		fileTabActive: true,
	};
}

function closeFileViewerTabWithFilter(
	profile: ProfileFileViewerState,
	filePath: string,
) {
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
}

function updateDirtyFileListWithFilter(
	dirtyFiles: string[],
	filePath: string,
	isDirty: boolean,
) {
	const alreadyDirty = dirtyFiles.includes(filePath);

	if (isDirty) {
		return alreadyDirty ? dirtyFiles : [...dirtyFiles, filePath];
	}

	if (!alreadyDirty) return dirtyFiles;
	const nextDirtyFiles = dirtyFiles.filter((path) => path !== filePath);
	return nextDirtyFiles.length > 0 ? nextDirtyFiles : null;
}

describe("file viewer tab closing", () => {
	bench("findIndex plus filter close", () => {
		const profile = makeProfile();
		closeFileViewerTabWithFilter(profile, targetPath);
		sink = profile.tabs.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("findIndex plus splice close", () => {
		const profile = makeProfile();
		closeFileViewerTab(profile, targetPath);
		sink = profile.tabs.length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});

describe("file viewer dirty list updates", () => {
	bench("includes plus filter dirty removal", () => {
		const nextDirtyFiles = updateDirtyFileListWithFilter(
			dirtyFiles,
			dirtyTargetPath,
			false,
		);
		sink = nextDirtyFiles?.length ?? 0;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("indexOf plus splice dirty removal", () => {
		const nextDirtyFiles = updateDirtyFileList(
			dirtyFiles,
			dirtyTargetPath,
			false,
		);
		sink = nextDirtyFiles?.length ?? 0;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
