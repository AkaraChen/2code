import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "@/features/terminal/store";
import {
	useActiveProfileIds,
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "./fileViewerTabsStore";

function resetStores() {
	useFileViewerTabsStore.setState({ profiles: {} });
	useFileViewerDirtyStore.setState({
		profiles: {},
		drafts: {},
		savedValues: {},
	});
	useTerminalStore.setState({
		profiles: {},
		agentStatuses: {},
		agentCompletions: {},
		sessionProfileIds: {},
	});
	localStorage.clear();
}

describe("fileViewerTabsStore", () => {
	beforeEach(resetStores);

	it("opens files per profile and derives tab titles from the file path", () => {
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");

		expect(useFileViewerTabsStore.getState().profiles["profile-1"]).toEqual({
			tabs: [
				{
					filePath: "/repo/src/main.tsx",
					title: "main.tsx",
				},
			],
			activeFilePath: "/repo/src/main.tsx",
			fileTabActive: true,
			notesActive: false,
		});
	});

	it("deduplicates reopened files and keeps the file tab active", () => {
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");

		expect(useFileViewerTabsStore.getState().profiles["profile-1"].tabs).toEqual([
			{
				filePath: "/repo/src/main.tsx",
				title: "main.tsx",
			},
		]);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].activeFilePath).toBe(
			"/repo/src/main.tsx",
		);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			true,
		);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].notesActive).toBe(
			false,
		);
	});

	it("closes active tabs by selecting the nearest remaining file and removes empty profiles", () => {
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/a.ts");
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/b.ts");
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/c.ts");

		useFileViewerTabsStore.getState().closeTab("profile-1", "/repo/src/b.ts");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].activeFilePath).toBe(
			"/repo/src/c.ts",
		);

		useFileViewerTabsStore.getState().closeTab("profile-1", "/repo/src/c.ts");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].activeFilePath).toBe(
			"/repo/src/a.ts",
		);

		useFileViewerTabsStore.getState().closeTab("profile-1", "/repo/src/a.ts");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"]).toBeUndefined();
	});

	it("tracks dirty file tabs and clears dirty state when a tab closes", () => {
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/a.ts");
		useFileViewerDirtyStore
			.getState()
			.setFileDirty("profile-1", "/repo/src/a.ts", true);
		useFileViewerDirtyStore
			.getState()
			.setFileDraft("profile-1", "/repo/src/a.ts", "draft");
		useFileViewerDirtyStore
			.getState()
			.setFileSavedValue("profile-1", "/repo/src/a.ts", "saved");

		expect(useFileViewerDirtyStore.getState().profiles["profile-1"]).toEqual([
			"/repo/src/a.ts",
		]);

		useFileViewerTabsStore.getState().closeTab("profile-1", "/repo/src/a.ts");

		expect(useFileViewerDirtyStore.getState().profiles["profile-1"]).toBeUndefined();
		expect(useFileViewerDirtyStore.getState().drafts["profile-1"]).toBeUndefined();
		expect(useFileViewerDirtyStore.getState().savedValues["profile-1"]).toBeUndefined();
	});

	it("switches between file and terminal focus for a profile", () => {
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");

		useFileViewerTabsStore.getState().setNotesActive("profile-1");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].notesActive).toBe(
			true,
		);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			false,
		);

		useFileViewerTabsStore.getState().setTerminalActive("profile-1");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			false,
		);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].notesActive).toBe(
			false,
		);

		useFileViewerTabsStore
			.getState()
			.setFileActive("profile-1", "/repo/src/main.tsx");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			true,
		);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].notesActive).toBe(
			false,
		);
	});

	it("keeps notes-only profiles active until terminal focus clears them", () => {
		useFileViewerTabsStore.getState().setNotesActive("profile-notes");

		expect(useFileViewerTabsStore.getState().profiles["profile-notes"]).toEqual({
			tabs: [],
			activeFilePath: null,
			fileTabActive: false,
			notesActive: true,
		});

		useFileViewerTabsStore.getState().setTerminalActive("profile-notes");

		expect(useFileViewerTabsStore.getState().profiles["profile-notes"]).toBeUndefined();
	});

	it("keeps notes visible when the last file tab closes", () => {
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/a.ts");
		useFileViewerTabsStore.getState().setNotesActive("profile-1");
		useFileViewerTabsStore.getState().closeTab("profile-1", "/repo/src/a.ts");

		expect(useFileViewerTabsStore.getState().profiles["profile-1"]).toEqual({
			tabs: [],
			activeFilePath: null,
			fileTabActive: false,
			notesActive: true,
		});
	});

	it("combines terminal and file-viewer profile ids without duplicates", () => {
		const { result } = renderHook(() => useActiveProfileIds());

		act(() => {
			useTerminalStore
				.getState()
				.addTab("profile-terminal", "session-1", "Terminal 1");
			useTerminalStore
				.getState()
				.addTab("profile-shared", "session-2", "Terminal 2");
			useFileViewerTabsStore
				.getState()
				.openFile("profile-shared", "/repo/src/shared.ts");
			useFileViewerTabsStore
				.getState()
				.openFile("profile-file", "/repo/src/file.ts");
			useFileViewerTabsStore.getState().setNotesActive("profile-notes");
		});

		expect(result.current).toEqual([
			"profile-terminal",
			"profile-shared",
			"profile-file",
			"profile-notes",
		]);
	});
});
