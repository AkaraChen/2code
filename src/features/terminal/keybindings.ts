export interface TerminalShortcutKeyEvent {
	type: string;
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

function isMacPlatform(platform: string) {
	return platform.toUpperCase().includes("MAC");
}

export function getTerminalShortcutSequence(
	event: TerminalShortcutKeyEvent,
	platform = globalThis.navigator?.platform ?? "",
): string | null {
	if (event.type !== "keydown") return null;
	if (event.ctrlKey || event.shiftKey) return null;

	if (isMacPlatform(platform) && event.metaKey && !event.altKey) {
		if (event.key === "ArrowLeft") return "\x1b[H";
		if (event.key === "ArrowRight") return "\x1b[F";
	}

	if (event.altKey && !event.metaKey) {
		if (event.key === "ArrowLeft") return "\x1bb";
		if (event.key === "ArrowRight") return "\x1bf";
	}

	return null;
}
