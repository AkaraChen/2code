export interface TerminalShortcutKeyEvent {
	type: string;
	key: string;
	code?: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

export type TerminalShortcutAction =
	| { type: "write-sequence"; sequence: string }
	| { type: "increase-font-size" }
	| { type: "decrease-font-size" }
	| { type: "clear-screen" };

function isMacPlatform(platform: string) {
	return platform.toUpperCase().includes("MAC");
}

function isPlainMetaShortcut(
	event: TerminalShortcutKeyEvent,
	platform: string,
) {
	return (
		isMacPlatform(platform)
		&& event.metaKey
		&& !event.ctrlKey
		&& !event.altKey
	);
}

export function getTerminalShortcutAction(
	event: TerminalShortcutKeyEvent,
	platform = globalThis.navigator?.platform ?? "",
): TerminalShortcutAction | null {
	if (event.type !== "keydown") return null;

	if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
		return { type: "write-sequence", sequence: "\n" };
	}

	if (isPlainMetaShortcut(event, platform) && !event.shiftKey) {
		if (event.key === "ArrowLeft") {
			return { type: "write-sequence", sequence: "\x1B[H" };
		}
		if (event.key === "ArrowRight") {
			return { type: "write-sequence", sequence: "\x1B[F" };
		}
	}

	if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		if (event.key === "ArrowLeft") {
			return { type: "write-sequence", sequence: "\x1Bb" };
		}
		if (event.key === "ArrowRight") {
			return { type: "write-sequence", sequence: "\x1Bf" };
		}
	}

	if (isPlainMetaShortcut(event, platform)) {
		if (
			event.code === "Equal"
			|| event.key === "="
			|| event.key === "+"
		) {
			return { type: "increase-font-size" };
		}
		if (
			event.code === "Minus"
			|| event.key === "-"
			|| event.key === "_"
		) {
			return { type: "decrease-font-size" };
		}
	}

	if (
		event.ctrlKey
		&& !event.metaKey
		&& !event.altKey
		&& !event.shiftKey
		&& event.key.toLowerCase() === "l"
	) {
		return { type: "clear-screen" };
	}

	return null;
}

export function getTerminalShortcutSequence(
	event: TerminalShortcutKeyEvent,
	platform = globalThis.navigator?.platform ?? "",
): string | null {
	const action = getTerminalShortcutAction(event, platform);
	if (action?.type !== "write-sequence") return null;
	return action.sequence;
}
