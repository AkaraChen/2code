import { beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_FILE_TREE_PANEL_WIDTH,
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	migrateFileTreePersistedState,
	useFileTreeStore,
} from "./fileTreeStore";

function resetStore() {
	useFileTreeStore.setState({
		openProfiles: {},
		panelWidth: DEFAULT_FILE_TREE_PANEL_WIDTH,
	});
	localStorage.clear();
}

function getState() {
	return useFileTreeStore.getState();
}

describe("useFileTreeStore", () => {
	beforeEach(resetStore);

	it("defaults the panel width", () => {
		expect(getState().panelWidth).toBe(DEFAULT_FILE_TREE_PANEL_WIDTH);
	});

	it("clamps widths below the minimum", () => {
		getState().setPanelWidth(FILE_TREE_PANEL_MIN_WIDTH - 40);
		expect(getState().panelWidth).toBe(FILE_TREE_PANEL_MIN_WIDTH);
	});

	it("clamps widths above the maximum", () => {
		getState().setPanelWidth(FILE_TREE_PANEL_MAX_WIDTH + 40);
		expect(getState().panelWidth).toBe(FILE_TREE_PANEL_MAX_WIDTH);
	});

	it("clamps migrated widths below the minimum", () => {
		expect(
			migrateFileTreePersistedState({
				panelWidth: FILE_TREE_PANEL_MIN_WIDTH - 40,
			}).panelWidth,
		).toBe(FILE_TREE_PANEL_MIN_WIDTH);
	});

	it("clamps migrated widths above the maximum", () => {
		expect(
			migrateFileTreePersistedState({
				panelWidth: FILE_TREE_PANEL_MAX_WIDTH + 40,
			}).panelWidth,
		).toBe(FILE_TREE_PANEL_MAX_WIDTH);
	});

	it("falls back to the default width for invalid migrated values", () => {
		expect(
			migrateFileTreePersistedState({
				panelWidth: "not-a-number",
			}).panelWidth,
		).toBe(DEFAULT_FILE_TREE_PANEL_WIDTH);
	});

	it("defaults file trees to open", () => {
		expect(getState().isOpen("profile-1")).toBe(true);
	});

	it("toggles a profile-specific open state", () => {
		getState().toggle("profile-1");
		expect(getState().isOpen("profile-1")).toBe(false);

		getState().toggle("profile-1");
		expect(getState().isOpen("profile-1")).toBe(true);
	});
});
