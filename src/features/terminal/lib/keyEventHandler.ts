import type { Terminal as XTerm } from "@xterm/xterm";
import { isMacPlatform, isWindowsPlatform } from "@/shared/lib/platform";

/**
 * xterm's _keyDown calls stopPropagation after processing, so any chord we
 * want the host or the shell to see must short-circuit xterm before it runs.
 * (VSCode pattern: terminalInstance.ts:1116-1175.)
 *
 * Kitty keyboard protocol is enabled, which means every Mac Cmd chord xterm
 * sees gets CSI-u encoded and leaks into TUIs as a literal char. Ghostty
 * sidesteps this by suppressing all super/Cmd chords on macOS before the
 * encoder runs. We do the same here.
 */

export interface TerminalKeyEventHandlerOptions {
	isMac?: boolean;
	isWindows?: boolean;
}

/**
 * Check if the event is a clipboard shortcut that should bubble to the browser
 * (so xterm's paste event fires) rather than being encoded by xterm.
 */
function shouldBubbleClipboardShortcut(
	event: KeyboardEvent,
	isMac: boolean,
	isWindows: boolean,
	hasSelection: boolean,
): boolean {
	if (isMac) {
		// Cmd+C/V/X/A — suppress all super chords on macOS (ghostty pattern)
		if (!event.metaKey) return false;
		const key = event.key.toLowerCase();
		if (key === "c") return true;
		if (key === "v") return true;
		if (key === "x") return true;
		if (key === "a") return true;
		return false;
	}

	if (isWindows) {
		// Ctrl+Shift+C/V — Linux/Windows terminal convention
		if (!event.ctrlKey || !event.shiftKey) return false;
		const key = event.key.toLowerCase();
		if (key === "c") return hasSelection;
		if (key === "v") return true;
		return false;
	}

	return false;
}

/**
 * Translate Ctrl+A/E/U/W/K etc. line-edit chords to escape sequences.
 * These are readline-style shortcuts that shells understand.
 */
function translateLineEditChord(
	event: KeyboardEvent,
	isMac: boolean,
): string | null {
	// On Mac, Ctrl+A/E/U/W/K/B/F/D/H are readline shortcuts
	// On Windows/Linux, these are less common but still supported by bash/zsh
	if (event.altKey || event.metaKey) return null;
	if (!event.ctrlKey) return null;

	const key = event.key.toLowerCase();
	const map: Record<string, string> = {
		a: "\x01", // Move to beginning of line
		b: "\x02", // Move back one char
		d: "\x04", // Delete forward (or EOF)
		e: "\x05", // Move to end of line
		f: "\x06", // Move forward one char
		h: "\x08", // Delete backward
		k: "\x0B", // Kill to end of line
		u: "\x15", // Kill to beginning of line
		w: "\x17", // Kill word backward
	};

	if (isMac && key in map) return map[key];
	if (!isMac && key in map && key !== "a" && key !== "e") return map[key];
	return null;
}

export function createTerminalKeyEventHandler(
	terminal: XTerm,
	options: TerminalKeyEventHandlerOptions = {},
) {
	const isMac = options.isMac ?? isMacPlatform();
	const isWindows = options.isWindows ?? isWindowsPlatform();

	return (event: KeyboardEvent): boolean => {
		// Line edit chords: translate to escape sequences before xterm encodes them
		const translation = translateLineEditChord(event, isMac);
		if (translation !== null) {
			if (event.type === "keydown") {
				event.preventDefault();
				terminal.input(translation, true);
			}
			return false;
		}

		// Select All: Cmd+A on Mac, Ctrl+Shift+A on Windows/Linux
		const isSelectAll =
			(isMac && event.metaKey && event.key.toLowerCase() === "a") ||
			(!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "a");
		if (isSelectAll) {
			if (event.type === "keydown") {
				event.preventDefault();
				terminal.selectAll();
			}
			return false;
		}

		// Clipboard shortcuts: let them bubble to the browser paste pipeline
		if (
			shouldBubbleClipboardShortcut(
				event,
				isMac,
				isWindows,
				terminal.hasSelection(),
			)
		) {
			// Do NOT preventDefault: the browser keydown -> paste pipeline is what
			// fires xterm's paste event. We only short-circuit xterm's key encoder.
			return false;
		}

		return true;
	};
}
