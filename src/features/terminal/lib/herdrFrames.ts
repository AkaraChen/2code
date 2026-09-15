/**
 * Apply verified Herdr `terminal.frame` semantics to an xterm.js surface.
 *
 * `full: true` is a replacement screen (Task 1 fixture `frames/full-redraw.json`).
 * `full: false` is incremental output on the current surface (`frames/incremental.json`).
 * Bytes stay bytes — xterm.js decodes UTF-8 across writes.
 */

export interface HerdrFrameView {
	seq: number;
	full: boolean;
	bytes: ArrayLike<number>;
}

export type HerdrFrameAction =
	| { readonly kind: "replace"; readonly bytes: Uint8Array }
	| { readonly kind: "append"; readonly bytes: Uint8Array };

/** Minimal xterm surface used to apply a decoded Herdr frame. */
export interface HerdrXtermSurface {
	reset(): void;
	write(data: Uint8Array, callback?: () => void): void;
}

export function herdrFrameBytes(frame: HerdrFrameView): Uint8Array {
	return Uint8Array.from(frame.bytes);
}

/**
 * `replace` resets scrollback first. CSI `2J` in the payload is not enough.
 * `append` writes onto the current surface.
 */
export function applyHerdrFrameAction(
	surface: HerdrXtermSurface,
	action: HerdrFrameAction,
	onWrote?: () => void,
): void {
	if (action.kind === "replace") {
		surface.reset();
	}
	surface.write(action.bytes, onWrote);
}

/**
 * Tracks `seq` on one attach stream. Duplicate or older frames are ignored.
 * A later `full: true` frame with a higher `seq` is a new surface.
 */
export class HerdrFrameCursor {
	#lastSeq = 0;

	apply(frame: HerdrFrameView): HerdrFrameAction | null {
		if (!Number.isFinite(frame.seq) || frame.seq <= this.#lastSeq) {
			return null;
		}
		this.#lastSeq = frame.seq;
		const bytes = herdrFrameBytes(frame);
		return frame.full
			? { kind: "replace", bytes }
			: { kind: "append", bytes };
	}
}
