import { describe, expect, it } from "vitest";
import {
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
		).toBe("\x1b[H");
	});

	it("maps Cmd+Right to line end on macOS", () => {
		expect(
			getTerminalShortcutSequence(
				makeEvent({ metaKey: true, key: "ArrowRight" }),
				"MacIntel",
			),
		).toBe("\x1b[F");
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
		).toBe("\x1bb");
	});

	it("maps Alt+Right to next word", () => {
		expect(
			getTerminalShortcutSequence(makeEvent({ altKey: true, key: "ArrowRight" })),
		).toBe("\x1bf");
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
