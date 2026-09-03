import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * For file/image clipboard payloads (screenshot, copied file, web image),
 * xterm.js's built-in paste handler reads an empty string from
 * `clipboardData.getData("text/plain")` and still emits empty bracketed-paste
 * markers. TUIs that key off `^V` to attach the image (Codex, Claude Code,
 * opencode) never see the signal.
 *
 * Forward `\x16` (Ctrl+V) instead, mirroring iTerm's "Paste or send ^V".
 *
 * Trigger only on `data.files.length > 0` (W3C `DataTransfer.files`):
 * Chromium synthesizes a File entry for any image/file clipboard payload.
 *
 * Capture phase on the wrapper runs before xterm's textarea/element paste
 * listeners, so `stopImmediatePropagation` cleanly preempts the bracketed-paste
 * wrap.
 */

function isNonTextPaste(event: ClipboardEvent): boolean {
	const data = event.clipboardData;
	if (!data) return false;
	if (data.getData("text/plain")) return false;
	return (data.files?.length ?? 0) > 0;
}

function handleImagePasteFallback(
	event: ClipboardEvent,
	terminal: XTerm,
): void {
	if (!isNonTextPaste(event)) return;
	event.preventDefault();
	event.stopImmediatePropagation();
	terminal.input("\x16", true);
}

export function installImagePasteFallback(
	terminal: XTerm,
	wrapper: HTMLElement,
): () => void {
	const handler = (event: ClipboardEvent) => {
		handleImagePasteFallback(event, terminal);
	};

	wrapper.addEventListener("paste", handler, { capture: true });
	return () => {
		wrapper.removeEventListener("paste", handler, { capture: true });
	};
}
