import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarSettingsStore } from "./sidebarSettingsStore";

function resetStore() {
	useSidebarSettingsStore.setState({ showProjectAvatars: true });
	localStorage.clear();
}

function getState() {
	return useSidebarSettingsStore.getState();
}

describe("useSidebarSettingsStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("shows project avatars by default", () => {
			expect(getState().showProjectAvatars).toBe(true);
		});
	});

	describe("setShowProjectAvatars", () => {
		it("updates showProjectAvatars", () => {
			getState().setShowProjectAvatars(false);
			expect(getState().showProjectAvatars).toBe(false);

			getState().setShowProjectAvatars(true);
			expect(getState().showProjectAvatars).toBe(true);
		});
	});
});
