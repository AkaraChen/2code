import type { Terminal as XTerm } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAttachedContext } from "./attachedCanvas";
import { installAttachedCanvasMetrics } from "./xtermMetricsPatch";

vi.mock("./attachedCanvas", () => ({
	createAttachedContext: vi.fn(),
}));

/** Advance widths keyed by primary family, as WebKit would resolve them. */
const ATTACHED_EM: Record<string, number> = {
	"SarasaNZSSlab NFM": 0.5,
	fallback: 0.6,
};

function makeContext() {
	const ctx = {
		font: "10px sans-serif",
		measureText(_text: string) {
			const match = /(\d+(?:\.\d+)?)px (.*)$/.exec(ctx.font);
			const size = match ? Number(match[1]) : 10;
			const family = match
				? match[2].split(",")[0].trim().replace(/^"|"$/g, "")
				: "";
			const em = ATTACHED_EM[family] ?? ATTACHED_EM.fallback;
			return {
				width: size * em,
				fontBoundingBoxAscent: size,
				fontBoundingBoxDescent: size * 0.25,
			};
		},
	};
	return ctx;
}

interface Harness {
	terminal: XTerm;
	charSizeService: {
		_measureStrategy: { measure: () => { width: number; height: number } };
		measure: ReturnType<typeof vi.fn>;
	};
	widthCache: {
		_canvasElements: Array<{
			setFont: (f: string, s: number, w: string, i: boolean) => void;
			measure: (text: string) => number;
		}>;
		_font: string;
		setFont: ReturnType<typeof vi.fn>;
		clear: ReturnType<typeof vi.fn>;
	};
	originalStrategy: { measure: () => { width: number; height: number } };
	originalElements: unknown[];
}

function makeHarness(): Harness {
	// The stock strategy reports the fallback metric, as a detached canvas would.
	const originalStrategy = { measure: () => ({ width: 8.4, height: 17 }) };
	const originalElements = [0, 1, 2, 3].map(() => ({
		setFont: vi.fn(),
		measure: vi.fn(() => 8.4),
	}));

	const charSizeService = {
		_measureStrategy: originalStrategy,
		measure: vi.fn(),
	};
	const widthCache = {
		_canvasElements: originalElements,
		_font: '"SarasaNZSSlab NFM", monospace',
		setFont: vi.fn(),
		clear: vi.fn(),
	};

	const terminal = {
		options: {
			fontFamily: '"SarasaNZSSlab NFM", monospace',
			fontSize: 14,
			fontWeight: "normal",
			fontWeightBold: "bold",
		},
		_core: {
			_charSizeService: charSizeService,
			_renderService: { _renderer: { value: { _widthCache: widthCache } } },
		},
	} as unknown as XTerm;

	return {
		terminal,
		charSizeService: charSizeService as unknown as Harness["charSizeService"],
		widthCache: widthCache as unknown as Harness["widthCache"],
		originalStrategy,
		originalElements,
	};
}

describe("installAttachedCanvasMetrics", () => {
	beforeEach(() => {
		vi.mocked(createAttachedContext).mockImplementation(() => ({
			ctx: makeContext() as unknown as CanvasRenderingContext2D,
			dispose: vi.fn(),
		}));
	});

	it("patches both measurement seams", () => {
		const h = makeHarness();
		const result = installAttachedCanvasMetrics(h.terminal);

		expect(result.patchedCharSize).toBe(true);
		expect(result.patchedWidthCache).toBe(true);
	});

	it("makes the char size strategy report the real font advance", () => {
		const h = makeHarness();
		installAttachedCanvasMetrics(h.terminal);

		// 14px × 0.5 em = 7.0, not the 8.4 the stock strategy reported.
		expect(h.charSizeService._measureStrategy.measure().width).toBeCloseTo(7, 3);
	});

	it("keeps the width cache consistent with the char size", () => {
		const h = makeHarness();
		installAttachedCanvasMetrics(h.terminal);

		const cellWidth = h.charSizeService._measureStrategy.measure().width;
		h.widthCache._canvasElements[0].setFont(
			'"SarasaNZSSlab NFM", monospace',
			14,
			"normal",
			false,
		);
		const glyphWidth = h.widthCache._canvasElements[0].measure("W");

		// Equal widths mean the DOM renderer computes zero letter-spacing
		// compensation, which is what "the grid matches the glyphs" looks like.
		expect(glyphWidth).toBeCloseTo(cellWidth, 3);
	});

	it("re-applies the font so swapped canvases are not left unconfigured", () => {
		const h = makeHarness();
		installAttachedCanvasMetrics(h.terminal);

		expect(h.widthCache._font).not.toBe('"SarasaNZSSlab NFM", monospace');
		expect(h.widthCache.setFont).toHaveBeenCalledWith(
			'"SarasaNZSSlab NFM", monospace',
			14,
			"normal",
			"bold",
		);
	});

	it("triggers a re-measure so the renderer picks up new dimensions", () => {
		const h = makeHarness();
		installAttachedCanvasMetrics(h.terminal);

		expect(h.charSizeService.measure).toHaveBeenCalled();
	});

	it("restores the original surfaces on dispose", () => {
		const h = makeHarness();
		const result = installAttachedCanvasMetrics(h.terminal);
		result.dispose();

		expect(h.charSizeService._measureStrategy).toBe(h.originalStrategy);
		expect(h.widthCache._canvasElements).toBe(h.originalElements);
	});

	it("reports nothing patched when the internals are missing", () => {
		const terminal = { options: { fontFamily: "x", fontSize: 14 } } as XTerm;
		const result = installAttachedCanvasMetrics(terminal);

		expect(result.patchedCharSize).toBe(false);
		expect(result.patchedWidthCache).toBe(false);
		expect(() => result.dispose()).not.toThrow();
	});
});
