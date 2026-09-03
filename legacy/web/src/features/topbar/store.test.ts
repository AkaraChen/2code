import { beforeEach, describe, expect, it } from "vitest";
import {
	defaultActiveControls,
	defaultEditorApp,
	defaultTerminalApp,
	useTopBarStore,
} from "./store";

function resetStore() {
	useTopBarStore.setState({
		activeControls: [...defaultActiveControls],
		controlOptions: {},
		editorApp: defaultEditorApp,
		terminalApp: defaultTerminalApp,
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
				"editor",
				"pr-status",
			]);
		});

		it("has empty controlOptions", () => {
			expect(getState().controlOptions).toEqual({});
		});

		it("has default editor and terminal apps", () => {
			expect(getState().editorApp).toBe("vscode");
			expect(getState().terminalApp).toBe("ghostty");
		});
	});

	describe("setActiveControls", () => {
		it("replaces the active controls list", () => {
			getState().setActiveControls(["editor", "terminal"]);
			expect(getState().activeControls).toEqual(["editor", "terminal"]);
		});

		it("can set to empty array", () => {
			getState().setActiveControls([]);
			expect(getState().activeControls).toEqual([]);
		});
	});

	describe("setEditorApp / setTerminalApp", () => {
		it("updates the configured editor app", () => {
			getState().setEditorApp("cursor");
			expect(getState().editorApp).toBe("cursor");
		});

		it("updates the configured terminal app", () => {
			getState().setTerminalApp("warp");
			expect(getState().terminalApp).toBe("warp");
		});
	});

	describe("setControlOption", () => {
		it("sets a single option for a control", () => {
			getState().setControlOption("editor", "path", "/usr/bin/code");
			expect(getState().controlOptions.editor).toEqual({
				path: "/usr/bin/code",
			});
		});

		it("merges with existing options for the same control", () => {
			getState().setControlOption("editor", "path", "/usr/bin/code");
			getState().setControlOption("editor", "args", "--new-window");
			expect(getState().controlOptions.editor).toEqual({
				path: "/usr/bin/code",
				args: "--new-window",
			});
		});

		it("merges options from different controls", () => {
			getState().setControlOption("editor", "path", "a");
			getState().setControlOption("terminal", "path", "b");
			expect(getState().controlOptions.editor).toEqual({ path: "a" });
			expect(getState().controlOptions.terminal).toEqual({ path: "b" });
		});

		it("overwrites an existing key for the same control", () => {
			getState().setControlOption("editor", "path", "old");
			getState().setControlOption("editor", "path", "new");
			expect(getState().controlOptions.editor.path).toBe("new");
		});

		it("preserves other controls when updating one", () => {
			getState().setControlOption("editor", "path", "a");
			getState().setControlOption("terminal", "path", "b");
			getState().setControlOption("editor", "args", "c");
			expect(getState().controlOptions.terminal).toEqual({ path: "b" });
		});
	});

	describe("resetToDefaults", () => {
		it("restores activeControls to defaults", () => {
			getState().setActiveControls(["terminal"]);
			getState().resetToDefaults();
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});

		it("clears all controlOptions", () => {
			getState().setControlOption("editor", "path", "a");
			getState().resetToDefaults();
			expect(getState().controlOptions).toEqual({});
		});

		it("restores editor and terminal app choices", () => {
			getState().setEditorApp("zed");
			getState().setTerminalApp("kitty");
			getState().resetToDefaults();
			expect(getState().editorApp).toBe(defaultEditorApp);
			expect(getState().terminalApp).toBe(defaultTerminalApp);
		});

		it("activeControls is a fresh array (not same reference)", () => {
			getState().resetToDefaults();
			expect(getState().activeControls).not.toBe(defaultActiveControls);
			expect(getState().activeControls).toEqual(defaultActiveControls);
		});
	});

	describe("migration to v5", () => {
		function migrate(persisted: unknown, version: number) {
			return useTopBarStore.persist.getOptions().migrate?.(
				persisted,
				version,
			);
		}

		it("collapses per-app editor/terminal controls into generic ones", () => {
			const migrated = migrate(
				{
					activeControls: [
						"github-desktop",
						"cursor",
						"vscode",
						"warp",
						"pr-status",
					],
				},
				4,
			) as {
				activeControls: string[];
				editorApp: string;
				terminalApp: string;
			};
			expect(migrated.activeControls).toEqual([
				"github-desktop",
				"editor",
				"terminal",
				"pr-status",
			]);
			expect(migrated.editorApp).toBe("cursor");
			expect(migrated.terminalApp).toBe("warp");
		});

		it("falls back to default apps when none were active", () => {
			const migrated = migrate(
				{ activeControls: ["github-desktop", "pr-status"] },
				4,
			) as { editorApp: string; terminalApp: string };
			expect(migrated.editorApp).toBe(defaultEditorApp);
			expect(migrated.terminalApp).toBe(defaultTerminalApp);
		});

		it("still strips retired controls from very old versions", () => {
			const migrated = migrate(
				{ activeControls: ["git-diff", "reveal-in-finder", "vscode"] },
				1,
			) as { activeControls: string[] };
			expect(migrated.activeControls).toEqual(["pr-status", "editor"]);
		});
	});

	describe("setControlOption edge cases", () => {
		it("stores null as a value", () => {
			getState().setControlOption("editor", "path", null);
			expect(getState().controlOptions.editor.path).toBeNull();
		});

		it("stores undefined as a value", () => {
			getState().setControlOption("editor", "path", undefined);
			expect(getState().controlOptions.editor.path).toBeUndefined();
		});

		it("stores complex objects as values", () => {
			const complex = { nested: { arr: [1, 2, 3] } };
			getState().setControlOption("editor", "config", complex);
			expect(getState().controlOptions.editor.config).toEqual(complex);
		});

		it("handles rapid sequential updates to the same key", () => {
			for (let i = 0; i < 100; i++) {
				getState().setControlOption("editor", "count", i);
			}
			expect(getState().controlOptions.editor.count).toBe(99);
		});

		it("spreading undefined controlOptions[controlId] does not throw", () => {
			// First time setting an option for a control — ...state.controlOptions[controlId] is ...undefined
			expect(() =>
				getState().setControlOption("terminal", "path", "/bin/ws"),
			).not.toThrow();
			expect(getState().controlOptions.terminal).toEqual({
				path: "/bin/ws",
			});
		});
	});

	describe("setActiveControls edge cases", () => {
		it("accepts duplicate entries", () => {
			getState().setActiveControls(["editor", "editor", "editor"]);
			expect(getState().activeControls).toEqual([
				"editor",
				"editor",
				"editor",
			]);
		});
	});
});
