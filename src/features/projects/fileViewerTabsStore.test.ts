import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "@/features/terminal/store";
import {
	useActiveProfileIds,
	useFileViewerTabsStore,
} from "./fileViewerTabsStore";

function resetStores() {
	useFileViewerTabsStore.setState({ profiles: {} });
	useTerminalStore.setState({
		profiles: {},
		notifiedTabs: new Set<string>(),
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

	it("switches between file and terminal focus for a profile", () => {
		useFileViewerTabsStore
			.getState()
			.openFile("profile-1", "/repo/src/main.tsx");

		useFileViewerTabsStore.getState().setTerminalActive("profile-1");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			false,
		);

		useFileViewerTabsStore
			.getState()
			.setFileActive("profile-1", "/repo/src/main.tsx");
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].fileTabActive).toBe(
			true,
		);
	});

	it("reorders file tabs without changing the active file", () => {
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/a.ts");
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/b.ts");
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/c.ts");
		useFileViewerTabsStore
			.getState()
			.setFileActive("profile-1", "/repo/src/a.ts");

		useFileViewerTabsStore.getState().reorderTabs("profile-1", 0, 2);

		expect(
			useFileViewerTabsStore
				.getState()
				.profiles["profile-1"].tabs.map((tab) => tab.filePath),
		).toEqual([
			"/repo/src/b.ts",
			"/repo/src/c.ts",
			"/repo/src/a.ts",
		]);
		expect(useFileViewerTabsStore.getState().profiles["profile-1"].activeFilePath).toBe(
			"/repo/src/a.ts",
		);
	});

	it("ignores invalid file tab reorder requests", () => {
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/a.ts");
		useFileViewerTabsStore.getState().openFile("profile-1", "/repo/src/b.ts");

		useFileViewerTabsStore.getState().reorderTabs("profile-1", -1, 1);
		useFileViewerTabsStore.getState().reorderTabs("profile-1", 0, 99);

		expect(
			useFileViewerTabsStore
				.getState()
				.profiles["profile-1"].tabs.map((tab) => tab.filePath),
		).toEqual([
			"/repo/src/a.ts",
			"/repo/src/b.ts",
		]);
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
		});

		expect(result.current).toEqual([
			"profile-terminal",
			"profile-shared",
			"profile-file",
		]);
	});
});
