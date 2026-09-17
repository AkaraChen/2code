import type { Terminal } from "@xterm/xterm";

/**
 * Herdr's emulator already answers DSR/DA as PTY input (Task 1 fixture
 * `frames/dsr-da.json`). Swallow those queries on the xterm parser so
 * replies never leave through `onData` → `writeToTerminal`.
 */

function csiParam0(params: Array<number | number[]>): number {
	const first = params[0];
	if (Array.isArray(first)) {
		return first[0] ?? 0;
	}
	return first ?? 0;
}

/** CSI `6n` (DSR / CPR) or CSI `c` (primary DA). */
export function isHerdrDeviceQuery(
	id: { final: string; prefix?: string; intermediates?: string },
	params: Array<number | number[]>,
): boolean {
	if (id.prefix || id.intermediates) {
		return false;
	}
	if (id.final === "n") {
		return csiParam0(params) === 6;
	}
	return id.final === "c";
}

export function blockHerdrQueryReplies(terminal: Terminal): () => void {
	const disposables = [
		terminal.parser.registerCsiHandler({ final: "n" }, (params) =>
			isHerdrDeviceQuery({ final: "n" }, params),
		),
		terminal.parser.registerCsiHandler({ final: "c" }, (params) =>
			isHerdrDeviceQuery({ final: "c" }, params),
		),
	];
	return () => {
		for (const disposable of disposables) {
			disposable.dispose();
		}
	};
}
