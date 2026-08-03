import type { Terminal as XTerm } from "@xterm/xterm";
import {
	getSharedAttachedContext,
	resetSharedAttachedContext,
} from "./attachedCanvas";

/**
 * How far xterm's cached cell width may drift from the font's real advance
 * before we treat it as stale. `css.cell.width` is derived through a
 * `Math.round(canvasWidth)` step, so sub-pixel noise of ~0.5/cols is expected;
 * a genuine wrong-font measurement is off by a whole pixel or more.
 */
const CELL_WIDTH_TOLERANCE_PX = 0.1;

/** Drops the memoized measuring canvas. Test seam only. */
export function resetMeasureContext(): void {
	resetSharedAttachedContext();
}

function getMeasureContext(): CanvasRenderingContext2D | null {
	try {
		// Must be an *attached* canvas — a detached one cannot see locally
		// installed fonts on WebKit and would report fallback metrics here,
		// silently agreeing with the very measurement we are validating.
		return getSharedAttachedContext();
	} catch {
		return null;
	}
}

/**
 * Ground-truth advance width of one cell, read straight from the font.
 *
 * Mirrors xterm's own `TextMetrics` measure strategy (the advance of `W` at
 * the configured size) so the two numbers are directly comparable.
 * Returns null when the font shorthand is unusable or the font is not ready.
 */
export function measureAdvanceWidth(
	fontFamily: string,
	fontSize: number,
): number | null {
	const family = fontFamily.trim();
	if (!family || !Number.isFinite(fontSize) || fontSize <= 0) return null;

	const ctx = getMeasureContext();
	if (!ctx) return null;

	ctx.font = `${fontSize}px ${family}`;
	// Canvas silently ignores an unparsable font shorthand and keeps whatever
	// was set before — treat that as "cannot measure" rather than reporting a
	// width that belongs to some other font.
	if (!ctx.font.includes(`${fontSize}px`)) return null;

	const width = ctx.measureText("W").width;
	return Number.isFinite(width) && width > 0 ? width : null;
}

/** The cell width FitAddon divides the host width by when choosing `cols`. */
export function getRenderedCellWidth(terminal: XTerm): number | null {
	const width = terminal.dimensions?.css?.cell?.width;
	return typeof width === "number" && width > 0 ? width : null;
}

/** The cell width the configured font actually renders at. */
export function getExpectedCellWidth(terminal: XTerm): number | null {
	const advance = measureAdvanceWidth(
		String(terminal.options.fontFamily ?? ""),
		Number(terminal.options.fontSize ?? 0),
	);
	if (advance === null) return null;

	// xterm adds `Math.round(letterSpacing)` in device pixels, then converts back.
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const letterSpacing = Math.round(Number(terminal.options.letterSpacing ?? 0));
	return advance + letterSpacing / dpr;
}

/**
 * True when xterm's cached cell width disagrees with the configured font.
 *
 * This is the failure mode behind "terminal only fills ~80% of the window":
 * the char size was measured while a fallback font was still in use, so
 * FitAddon divides the host width by a stale (wider) cell and picks too few
 * columns. Fonts whose advance ratio is close to the fallback's (~0.6 em) hide
 * the bug; a 0.5 em CJK-aligned font such as Sarasa exposes it as a ~1/6 gap.
 */
export function isCellWidthStale(terminal: XTerm): boolean {
	const rendered = getRenderedCellWidth(terminal);
	const expected = getExpectedCellWidth(terminal);
	if (rendered === null || expected === null) return false;
	return Math.abs(rendered - expected) > CELL_WIDTH_TOLERANCE_PX;
}

interface CharSizeServiceLike {
	measure: () => void;
}

function getCharSizeService(terminal: XTerm): CharSizeServiceLike | null {
	const core = (
		terminal as unknown as {
			_core?: { _charSizeService?: Partial<CharSizeServiceLike> };
		}
	)._core;
	const service = core?._charSizeService;
	return service && typeof service.measure === "function"
		? (service as CharSizeServiceLike)
		: null;
}

/**
 * Make xterm re-measure the char size with the font that is loaded *now*.
 *
 * xterm only measures on `open()` and on a `fontFamily`/`fontSize` option
 * change — a font that finishes loading afterwards never triggers one, so the
 * stale measurement survives every later `fit()`. Prefer the internal service;
 * fall back to nudging the option, which is the only public trigger.
 */
export function forceCharSizeRemeasure(terminal: XTerm): void {
	const service = getCharSizeService(terminal);
	if (service) {
		service.measure();
		return;
	}

	const family = String(terminal.options.fontFamily ?? "").trim();
	if (!family) return;
	// The setter only fires when the value actually differs, hence the detour.
	terminal.options.fontFamily = `${family}, monospace`;
	terminal.options.fontFamily = family;
}

/**
 * Re-measure only when the cached cell width no longer matches the font.
 * Returns true when a re-measure was performed.
 */
export function remeasureIfStale(terminal: XTerm): boolean {
	if (!isCellWidthStale(terminal)) return false;
	forceCharSizeRemeasure(terminal);
	return true;
}
