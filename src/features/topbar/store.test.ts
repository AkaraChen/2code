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
				"open-with",
				"reveal-in-finder",
			]);
		});

		it("has empty controlOptions", () => {
			expect(getState().controlOptions).toEqual({});
		});
	});

	describe("setActiveControls", () => {
		it("replaces the active controls list", () => {
			getState().setActiveControls(["reveal-in-finder", "open-with"]);
			expect(getState().activeControls).toEqual([
				"reveal-in-finder",
				"open-with",
			]);
		});

		it("can set to empty array", () => {
			getState().setActiveControls([]);
			expect(getState().activeControls).toEqual([]);
		});
	});

	describe("setControlOption", () => {
		it("sets a single option for a control", () => {
			getState().setControlOption("open-with", "lastUsed", "vscode");
			expect(getState().controlOptions["open-with"]).toEqual({
				lastUsed: "vscode",
			});
		});

		it("merges with existing options for the same control", () => {
			getState().setControlOption("open-with", "lastUsed", "vscode");
			getState().setControlOption("open-with", "pinned", true);
			expect(getState().controlOptions["open-with"]).toEqual({
				lastUsed: "vscode",
				pinned: true,
			});
		});

		it("merges options from different controls", () => {
			getState().setControlOption("open-with", "lastUsed", "a");
			getState().setControlOption("reveal-in-finder", "lastUsed", "b");
			expect(getState().controlOptions["open-with"]).toEqual({
				lastUsed: "a",
			});
			expect(getState().controlOptions["reveal-in-finder"]).toEqual({
				lastUsed: "b",
			});
		});

		it("overwrites an existing key for the same control", () => {
			getState().setControlOption("open-with", "lastUsed", "old");
			getState().setControlOption("open-with", "lastUsed", "new");
			expect(getState().controlOptions["open-with"].lastUsed).toBe("new");
		});

		it("preserves other controls when updating one", () => {
			getState().setControlOption("open-with", "lastUsed", "a");
			getState().setControlOption("reveal-in-finder", "lastUsed", "b");
			getState().setControlOption("open-with", "pinned", true);
			expect(getState().controlOptions["reveal-in-finder"]).toEqual({
				lastUsed: "b",
			});
		});
	});

	describe("resetToDefaults", () => {
		it("restores activeControls to defaults", () => {
			getState().setActiveControls(["open-with"]);
			getState().resetToDefaults();
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});

		it("clears all controlOptions", () => {
			getState().setControlOption("open-with", "lastUsed", "a");
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
			getState().setControlOption("open-with", "lastUsed", null);
			expect(getState().controlOptions["open-with"].lastUsed).toBeNull();
		});

		it("stores undefined as a value", () => {
			getState().setControlOption("open-with", "lastUsed", undefined);
			expect(
				getState().controlOptions["open-with"].lastUsed,
			).toBeUndefined();
		});

		it("stores complex objects as values", () => {
			const complex = { nested: { arr: [1, 2, 3] } };
			getState().setControlOption("open-with", "config", complex);
			expect(getState().controlOptions["open-with"].config).toEqual(
				complex,
			);
		});

		it("handles rapid sequential updates to the same key", () => {
			for (let i = 0; i < 100; i++) {
				getState().setControlOption("open-with", "count", i);
			}
			expect(getState().controlOptions["open-with"].count).toBe(99);
		});

		it("spreading undefined controlOptions[controlId] does not throw", () => {
			// First time setting an option for a control — ...state.controlOptions[controlId] is ...undefined
			expect(() =>
				getState().setControlOption(
					"reveal-in-finder",
					"lastUsed",
					"/tmp",
				),
			).not.toThrow();
			expect(getState().controlOptions["reveal-in-finder"]).toEqual({
				lastUsed: "/tmp",
			});
		});
	});

	describe("setActiveControls edge cases", () => {
		it("accepts duplicate entries", () => {
			getState().setActiveControls([
				"open-with",
				"open-with",
				"open-with",
			]);
			expect(getState().activeControls).toEqual([
				"open-with",
				"open-with",
				"open-with",
			]);
		});
	});
});
