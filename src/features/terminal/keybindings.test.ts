import { describe, expect, it } from "vitest";
import {
	getTerminalShortcutAction,
	getTerminalShortcutSequence,
	type TerminalShortcutKeyEvent,
} from "./keybindings";

function makeEvent(
	overrides: Partial<TerminalShortcutKeyEvent> = {},
): TerminalShortcutKeyEvent {
	return {
		type: "keydown",
		key: "a",
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...overrides,
	};
}

describe("getTerminalShortcutSequence", () => {
	it("maps Cmd+Left to line start on macOS", () => {
		expect(
			getTerminalShortcutSequence(
				makeEvent({ metaKey: true, key: "ArrowLeft" }),
				"MacIntel",
			),
		).toBe("\x1B[H");
	});

	it("maps Cmd+Right to line end on macOS", () => {
		expect(
			getTerminalShortcutSequence(
				makeEvent({ metaKey: true, key: "ArrowRight" }),
				"MacIntel",
			),
		).toBe("\x1B[F");
	});

	it("does not map Cmd+Arrow on non-macOS platforms", () => {
		expect(
			getTerminalShortcutSequence(
				makeEvent({ metaKey: true, key: "ArrowLeft" }),
				"Win32",
			),
		).toBeNull();
	});

	it("maps Alt+Left to previous word", () => {
		expect(
			getTerminalShortcutSequence(makeEvent({ altKey: true, key: "ArrowLeft" })),
		).toBe("\x1Bb");
	});

	it("maps Alt+Right to next word", () => {
		expect(
			getTerminalShortcutSequence(makeEvent({ altKey: true, key: "ArrowRight" })),
		).toBe("\x1Bf");
	});

	it("ignores other modifier combinations and non-keydown events", () => {
		expect(
			getTerminalShortcutSequence(
				makeEvent({ ctrlKey: true, altKey: true, key: "ArrowLeft" }),
			),
		).toBeNull();
		expect(
			getTerminalShortcutSequence(
				makeEvent({ type: "keyup", metaKey: true, key: "ArrowLeft" }),
				"MacIntel",
			),
		).toBeNull();
	});
});

describe("getTerminalShortcutAction", () => {
	it("maps Cmd+= to increase font size on macOS", () => {
		expect(
			getTerminalShortcutAction(
				makeEvent({ metaKey: true, key: "=", code: "Equal" }),
				"MacIntel",
			),
		).toEqual({ type: "increase-font-size" });
	});

	it("maps Cmd++ to increase font size on macOS", () => {
		expect(
			getTerminalShortcutAction(
				makeEvent({
					metaKey: true,
					shiftKey: true,
					key: "+",
					code: "Equal",
				}),
				"MacIntel",
			),
		).toEqual({ type: "increase-font-size" });
	});

	it("maps Cmd+- to decrease font size on macOS", () => {
		expect(
			getTerminalShortcutAction(
				makeEvent({ metaKey: true, key: "-", code: "Minus" }),
				"MacIntel",
			),
		).toEqual({ type: "decrease-font-size" });
	});

	it("does not map font size shortcuts on non-macOS platforms", () => {
		expect(
			getTerminalShortcutAction(
				makeEvent({ metaKey: true, key: "=", code: "Equal" }),
				"Win32",
			),
		).toBeNull();
	});

	it("maps Ctrl+L to clear the terminal screen", () => {
		expect(
			getTerminalShortcutAction(makeEvent({ ctrlKey: true, key: "l" })),
		).toEqual({ type: "clear-screen" });
	});
});
