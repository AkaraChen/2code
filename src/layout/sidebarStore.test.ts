import { beforeEach, describe, expect, it } from "vitest";
import {
	APP_SIDEBAR_DEFAULT_WIDTH,
	APP_SIDEBAR_MAX_WIDTH,
	APP_SIDEBAR_MIN_WIDTH,
	useAppSidebarStore,
} from "./sidebarStore";

function resetStore() {
	useAppSidebarStore.setState({
		width: APP_SIDEBAR_DEFAULT_WIDTH,
		collapsedProjectGroupIds: [],
	});
	localStorage.clear();
}

function getState() {
	return useAppSidebarStore.getState();
}

describe("useAppSidebarStore", () => {
	beforeEach(resetStore);

	it("uses the default width", () => {
		expect(getState().width).toBe(APP_SIDEBAR_DEFAULT_WIDTH);
	});

	it("clamps widths below the minimum", () => {
		getState().setWidth(APP_SIDEBAR_MIN_WIDTH - 40);
		expect(getState().width).toBe(APP_SIDEBAR_MIN_WIDTH);
	});

	it("clamps widths above the maximum", () => {
		getState().setWidth(APP_SIDEBAR_MAX_WIDTH + 40);
		expect(getState().width).toBe(APP_SIDEBAR_MAX_WIDTH);
	});

	it("syncs the CSS variable on document.documentElement", () => {
		getState().setWidth(320);
		expect(
			document.documentElement.style.getPropertyValue("--sidebar-width"),
		).toBe("320px");
	});

	it("toggles collapsed project groups", () => {
		getState().toggleProjectGroup("group-1");
		expect(getState().collapsedProjectGroupIds).toEqual(["group-1"]);

		getState().toggleProjectGroup("group-1");
		expect(getState().collapsedProjectGroupIds).toEqual([]);
	});
});
