import { beforeEach, describe, expect, it } from "vitest";
import { defaultActiveControls, useTopBarStore } from "./store";

function resetStore() {
	useTopBarStore.setState({
		activeControls: [...defaultActiveControls],
		controlOptions: {},
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

		it("has empty controlOptions", () => {
			expect(getState().controlOptions).toEqual({});
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

	describe("setControlOption", () => {
		it("sets a single option for a control", () => {
			getState().setControlOption("vscode", "path", "/usr/bin/code");
			expect(getState().controlOptions.vscode).toEqual({
				path: "/usr/bin/code",
			});
		});

		it("merges with existing options for the same control", () => {
			getState().setControlOption("vscode", "path", "/usr/bin/code");
			getState().setControlOption("vscode", "args", "--new-window");
			expect(getState().controlOptions.vscode).toEqual({
				path: "/usr/bin/code",
				args: "--new-window",
			});
		});

		it("merges options from different controls", () => {
			getState().setControlOption("vscode", "path", "a");
			getState().setControlOption("cursor", "path", "b");
			expect(getState().controlOptions.vscode).toEqual({ path: "a" });
			expect(getState().controlOptions.cursor).toEqual({ path: "b" });
		});

		it("overwrites an existing key for the same control", () => {
			getState().setControlOption("vscode", "path", "old");
			getState().setControlOption("vscode", "path", "new");
			expect(getState().controlOptions.vscode.path).toBe("new");
		});

		it("preserves other controls when updating one", () => {
			getState().setControlOption("vscode", "path", "a");
			getState().setControlOption("cursor", "path", "b");
			getState().setControlOption("vscode", "args", "c");
			expect(getState().controlOptions.cursor).toEqual({ path: "b" });
		});
	});

	describe("resetToDefaults", () => {
		it("restores activeControls to defaults", () => {
			getState().setActiveControls(["cursor"]);
			getState().resetToDefaults();
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});

		it("clears all controlOptions", () => {
			getState().setControlOption("vscode", "path", "a");
			getState().resetToDefaults();
			expect(getState().controlOptions).toEqual({});
		});

		it("activeControls is a fresh array (not same reference)", () => {
			getState().resetToDefaults();
			expect(getState().activeControls).not.toBe(defaultActiveControls);
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});
	});
});
