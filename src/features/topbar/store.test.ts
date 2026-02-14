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

	describe("setControlOption edge cases", () => {
		it("stores null as a value", () => {
			getState().setControlOption("vscode", "path", null);
			expect(getState().controlOptions.vscode.path).toBeNull();
		});

		it("stores undefined as a value", () => {
			getState().setControlOption("vscode", "path", undefined);
			expect(getState().controlOptions.vscode.path).toBeUndefined();
		});

		it("stores complex objects as values", () => {
			const complex = { nested: { arr: [1, 2, 3] } };
			getState().setControlOption("vscode", "config", complex);
			expect(getState().controlOptions.vscode.config).toEqual(complex);
		});

		it("handles rapid sequential updates to the same key", () => {
			for (let i = 0; i < 100; i++) {
				getState().setControlOption("vscode", "count", i);
			}
			expect(getState().controlOptions.vscode.count).toBe(99);
		});

		it("spreading undefined controlOptions[controlId] does not throw", () => {
			// First time setting an option for a control — ...state.controlOptions[controlId] is ...undefined
			expect(() =>
				getState().setControlOption("windsurf", "path", "/bin/ws"),
			).not.toThrow();
			expect(getState().controlOptions.windsurf).toEqual({
				path: "/bin/ws",
			});
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
