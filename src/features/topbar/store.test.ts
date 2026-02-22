import { beforeEach, describe, expect, it } from "vitest";
import { defaultActiveControls, useTopBarStore } from "./store";

function resetStore() {
	useTopBarStore.setState({
		activeControls: [...defaultActiveControls],
	});
	localStorage.clear();
}

function getState() {
	return useTopBarStore.getState();
}

describe("useTopBarStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("has default active controls", () => {
			expect(getState().activeControls).toEqual([
				"github-desktop",
				"vscode",
				"git-diff",
			]);
		});
	});

	describe("setActiveControls", () => {
		it("replaces the active controls list", () => {
			getState().setActiveControls(["cursor", "windsurf"]);
			expect(getState().activeControls).toEqual(["cursor", "windsurf"]);
		});

		it("can set to empty array", () => {
			getState().setActiveControls([]);
			expect(getState().activeControls).toEqual([]);
		});
	});

	describe("resetToDefaults", () => {
		it("restores activeControls to defaults", () => {
			getState().setActiveControls(["cursor"]);
			getState().resetToDefaults();
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});

		it("activeControls is a fresh array (not same reference)", () => {
			getState().resetToDefaults();
			expect(getState().activeControls).not.toBe(defaultActiveControls);
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});
	});

	describe("setActiveControls edge cases", () => {
		it("accepts duplicate entries", () => {
			getState().setActiveControls(["vscode", "vscode", "vscode"]);
			expect(getState().activeControls).toEqual([
				"vscode",
				"vscode",
				"vscode",
			]);
		});
	});
});
