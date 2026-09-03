import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal as XTerm } from "@xterm/xterm";

export interface LoadAddonsResult {
	fitAddon: FitAddon;
	searchAddon: SearchAddon;
	serializeAddon: SerializeAddon;
	progressAddon: ProgressAddon;
	dispose: () => void;
}

export function loadAddons(
	terminal: XTerm,
	options: {
		onWebLinkActivate?: (event: MouseEvent, uri: string) => void;
	} = {},
): LoadAddonsResult {
	const fitAddon = new FitAddon();
	const searchAddon = new SearchAddon();
	const serializeAddon = new SerializeAddon();

	terminal.loadAddon(fitAddon);
	terminal.loadAddon(searchAddon);
	terminal.loadAddon(serializeAddon);
	terminal.loadAddon(new ClipboardAddon());
	terminal.loadAddon(new ImageAddon());
	const progressAddon = new ProgressAddon();
	terminal.loadAddon(progressAddon);

	if (options.onWebLinkActivate) {
		terminal.loadAddon(new WebLinksAddon(options.onWebLinkActivate));
	}

	try {
		terminal.loadAddon(new LigaturesAddon());
	} catch {
		// Ligatures not supported by current font
	}

	// Activate Unicode 11 widths before restoring any buffer, else CJK/emoji/ZWJ
	// widths get baked wrong into the replay.
	const unicode11 = new Unicode11Addon();
	terminal.loadAddon(unicode11);
	terminal.unicode.activeVersion = "11";

	// No GPU renderer addon is loaded, so xterm.js uses its built-in DOM
	// renderer. It repaints glyphs directly, so font changes need no atlas
	// invalidation — a plain `term.refresh()` suffices.
	return {
		fitAddon,
		searchAddon,
		serializeAddon,
		progressAddon,
		dispose: () => {},
	};
}
