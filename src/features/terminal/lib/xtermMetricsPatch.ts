import type { Terminal as XTerm } from "@xterm/xterm";
import { type AttachedContext, createAttachedContext } from "./attachedCanvas";

/**
 * Points xterm's two font-measurement surfaces at attached canvases.
 *
 * xterm measures through canvas but paints through the DOM. On WebKit a
 * detached/offscreen canvas cannot see locally installed fonts (see
 * `attachedCanvas.ts`), so both measurements come back with fallback metrics
 * while the DOM renders the real font. The terminal then reserves 8.4px cells
 * for glyphs it draws 7.0px wide and leaves ~1/6 of the viewport empty.
 *
 * Both seams must be patched together: the DOM renderer derives its
 * letter-spacing compensation from `cell.width - widthCache.get("W")`, so
 * fixing only one side would produce a ±1.4px spacing correction and render
 * text either cramped or spread out.
 *
 * Nothing about xterm's measurement *logic* changes — same `measureText("W")`,
 * same font shorthand, same font-bounding-box height. Only the surface differs.
 */

interface MeasuredSize {
	width: number;
	height: number;
}

interface MeasureStrategy {
	measure(): MeasuredSize;
}

interface WidthCacheCanvas {
	setFont(
		fontFamily: string,
		fontSize: number,
		fontWeight: string,
		italic: boolean,
	): void;
	measure(text: string): number;
}

interface WidthCacheLike {
	_canvasElements: WidthCacheCanvas[];
	_font: string;
	setFont(
		fontFamily: string,
		fontSize: number,
		fontWeight: string,
		fontWeightBold: string,
	): void;
	clear(): void;
}

interface CharSizeServiceLike {
	_measureStrategy: MeasureStrategy;
	measure(): void;
}

interface TerminalInternals {
	_core?: {
		_charSizeService?: CharSizeServiceLike;
		_renderService?: { _renderer?: { value?: { _widthCache?: WidthCacheLike } } };
	};
}

function getInternals(terminal: XTerm): {
	charSizeService: CharSizeServiceLike | null;
	widthCache: WidthCacheLike | null;
} {
	const core = (terminal as unknown as TerminalInternals)._core;
	const charSizeService = core?._charSizeService;
	const widthCache = core?._renderService?._renderer?.value?._widthCache;
	return {
		charSizeService:
			charSizeService && typeof charSizeService.measure === "function"
				? charSizeService
				: null,
		widthCache:
			widthCache && Array.isArray(widthCache._canvasElements)
				? widthCache
				: null,
	};
}

/** Mirrors xterm's `TextMetricsMeasureStrategy`, on an attached canvas. */
function createCharSizeStrategy(
	terminal: XTerm,
	attached: AttachedContext,
	fallback: MeasureStrategy,
): MeasureStrategy {
	const result: MeasuredSize = { width: 0, height: 0 };
	return {
		measure(): MeasuredSize {
			const fontFamily = String(terminal.options.fontFamily ?? "");
			const fontSize = Number(terminal.options.fontSize ?? 0);
			if (!fontFamily || !fontSize) return fallback.measure();

			attached.ctx.font = `${fontSize}px ${fontFamily}`;
			const metrics = attached.ctx.measureText("W");
			const width = metrics.width;
			const height =
				metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;

			// Same guard xterm applies: keep the last good value, never zero.
			if (width > 0 && height > 0) {
				result.width = width;
				result.height = height;
			}
			return result;
		},
	};
}

/** Mirrors xterm's width-cache canvas element, on an attached canvas. */
function createWidthCacheCanvas(attached: AttachedContext): WidthCacheCanvas {
	return {
		setFont(fontFamily, fontSize, fontWeight, italic) {
			attached.ctx.font =
				`${italic ? "italic" : ""} ${fontWeight} ${fontSize}px ${fontFamily}`.trim();
		},
		measure(text) {
			return attached.ctx.measureText(text).width;
		},
	};
}

export interface MetricsPatchResult {
	patchedCharSize: boolean;
	patchedWidthCache: boolean;
	dispose: () => void;
}

export function installAttachedCanvasMetrics(
	terminal: XTerm,
): MetricsPatchResult {
	const { charSizeService, widthCache } = getInternals(terminal);
	const contexts: AttachedContext[] = [];
	const restores: Array<() => void> = [];

	let patchedCharSize = false;
	if (charSizeService) {
		const attached = createAttachedContext();
		if (attached) {
			contexts.push(attached);
			const original = charSizeService._measureStrategy;
			charSizeService._measureStrategy = createCharSizeStrategy(
				terminal,
				attached,
				original,
			);
			restores.push(() => {
				charSizeService._measureStrategy = original;
			});
			patchedCharSize = true;
		}
	}

	let patchedWidthCache = false;
	if (widthCache) {
		const originalElements = widthCache._canvasElements;
		const replacements: WidthCacheCanvas[] = [];
		for (let i = 0; i < originalElements.length; i++) {
			const attached = createAttachedContext();
			if (!attached) break;
			contexts.push(attached);
			replacements.push(createWidthCacheCanvas(attached));
		}

		if (replacements.length === originalElements.length) {
			widthCache._canvasElements = replacements;
			restores.push(() => {
				widthCache._canvasElements = originalElements;
				reapplyWidthCacheFont(terminal, widthCache);
			});
			reapplyWidthCacheFont(terminal, widthCache);
			patchedWidthCache = true;
		}
	}

	// Re-measure so the new surfaces propagate: a changed char size fires
	// onCharSizeChange → renderer.handleCharSizeChanged → dimensions +
	// letter-spacing recomputed from the corrected width cache.
	charSizeService?.measure();

	return {
		patchedCharSize,
		patchedWidthCache,
		dispose: () => {
			for (const restore of restores) restore();
			charSizeService?.measure();
			for (const context of contexts) context.dispose();
		},
	};
}

/**
 * Forces the width cache to re-apply the current font to its canvases.
 * `setFont` short-circuits when the font is unchanged, so the memo has to be
 * invalidated first — otherwise freshly swapped canvases keep the 10px
 * sans-serif default.
 */
function reapplyWidthCacheFont(
	terminal: XTerm,
	widthCache: WidthCacheLike,
): void {
	widthCache._font = "";
	widthCache.setFont(
		String(terminal.options.fontFamily ?? ""),
		Number(terminal.options.fontSize ?? 0),
		String(terminal.options.fontWeight ?? "normal"),
		String(terminal.options.fontWeightBold ?? "bold"),
	);
	widthCache.clear();
}
