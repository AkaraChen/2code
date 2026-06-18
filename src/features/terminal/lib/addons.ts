import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal as XTerm } from "@xterm/xterm";

export interface LoadAddonsResult {
	fitAddon: FitAddon;
	searchAddon: SearchAddon;
	serializeAddon: SerializeAddon;
	progressAddon: ProgressAddon;
	webglAddon: () => WebglAddon | null;
	dispose: () => void;
}

// Once WebGL fails, skip it for all subsequent terminals (VS Code pattern).
let suggestedRendererType: "webgl" | "dom" | undefined;

export type { WebglAddon };

export function loadAddons(
	terminal: XTerm,
	options: {
		onWebLinkActivate?: (event: MouseEvent, uri: string) => void;
	} = {},
): LoadAddonsResult {
	let disposed = false;
	let webglAddon: WebglAddon | null = null;

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

	// Defer WebGL to rAF to avoid racing xterm's post-open viewport sync.
	const rafId = requestAnimationFrame(() => {
		if (disposed || suggestedRendererType === "dom") return;

		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon?.dispose();
				webglAddon = null;
				suggestedRendererType = "dom";
				terminal.refresh(0, terminal.rows - 1);
			});
			terminal.loadAddon(webglAddon);
		} catch {
			suggestedRendererType = "dom";
			webglAddon = null;
		}
	});

	return {
		fitAddon,
		searchAddon,
		serializeAddon,
		progressAddon,
		webglAddon: () => webglAddon,
		dispose: () => {
			disposed = true;
			cancelAnimationFrame(rafId);
			try {
				webglAddon?.dispose();
			} catch {}
			webglAddon = null;
		},
	};
}
