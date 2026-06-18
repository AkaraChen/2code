import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

const RESIZE_DEBOUNCE_MS = 75;

function hostIsVisible(container: HTMLElement | null): boolean {
	if (!container) return false;
	return container.clientWidth > 0 && container.clientHeight > 0;
}

/**
 * Measure and fit the terminal, preserving scroll position.
 * Returns true if cols/rows changed.
 */
export function measureAndResize(
	terminal: XTerm,
	fitAddon: FitAddon,
	container: HTMLElement | null,
): boolean {
	if (!hostIsVisible(container)) return false;

	const buffer = terminal.buffer.active;
	const wasPinnedToBottom = buffer.viewportY >= buffer.baseY;
	const savedViewportY = buffer.viewportY;
	const prevCols = terminal.cols;
	const prevRows = terminal.rows;

	fitAddon.fit();

	if (wasPinnedToBottom) {
		terminal.scrollToBottom();
	} else {
		const targetY = Math.min(savedViewportY, terminal.buffer.active.baseY);
		if (terminal.buffer.active.viewportY !== targetY) {
			terminal.scrollToLine(targetY);
		}
	}

	terminal.refresh(0, Math.max(0, terminal.rows - 1));

	return terminal.cols !== prevCols || terminal.rows !== prevRows;
}

export interface ResizeScheduler {
	observe: ResizeObserverCallback;
	dispose: () => void;
}

/**
 * Create a debounced resize scheduler (75ms).
 * Collapses consecutive ResizeObserver callbacks into a single fit.
 * Cancels immediately when container collapses to 0×0 (tab hidden).
 */
export function createResizeScheduler(
	terminal: XTerm,
	fitAddon: FitAddon,
	container: () => HTMLElement | null,
	onResize?: () => void,
): ResizeScheduler {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const dispose = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const run = () => {
		timeoutId = null;
		const changed = measureAndResize(terminal, fitAddon, container());
		if (changed) onResize?.();
	};

	const observe: ResizeObserverCallback = (entries) => {
		if (
			entries.some(
				(entry) =>
					entry.contentRect.width <= 0 || entry.contentRect.height <= 0,
			)
		) {
			dispose();
			return;
		}
		dispose();
		timeoutId = setTimeout(run, RESIZE_DEBOUNCE_MS);
	};

	return { observe, dispose };
}
