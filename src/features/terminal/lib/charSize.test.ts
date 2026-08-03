import type { Terminal as XTerm } from "@xterm/xterm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSharedAttachedContext } from "./attachedCanvas";
import {
	forceCharSizeRemeasure,
	isCellWidthStale,
	measureAdvanceWidth,
	remeasureIfStale,
	resetMeasureContext,
} from "./charSize";

// The real helper needs a canvas attached to a live document; the unit under
// test is the metrics comparison, so the surface is stubbed out.
vi.mock("./attachedCanvas", () => ({
	getSharedAttachedContext: vi.fn(() => null),
	resetSharedAttachedContext: vi.fn(),
}));

/**
 * Stand-in for the canvas 2d context: reports the advance width configured per
 * font family, so a test can model "Sarasa is 0.5em, Menlo is 0.6021em".
 */
function stubCanvas(advanceByFamily: Record<string, number>) {
	const ctx = {
		font: "10px sans-serif",
		measureText(_text: string) {
			const match = /^(\d+(?:\.\d+)?)px (.*)$/.exec(ctx.font);
			if (!match) return { width: 0 };
			const size = Number(match[1]);
			const primary = match[2].split(",")[0].trim().replace(/^"|"$/g, "");
			const ratio = advanceByFamily[primary] ?? advanceByFamily.fallback ?? 0;
			return { width: size * ratio };
		},
	};
	vi.mocked(getSharedAttachedContext).mockReturnValue(
		ctx as unknown as CanvasRenderingContext2D,
	);
	return ctx;
}

interface FakeTerminal {
	options: { fontFamily: string; fontSize: number; letterSpacing?: number };
	dimensions?: { css: { cell: { width: number; height: number } } };
	_core?: { _charSizeService?: { measure: () => void } };
}

function fakeTerminal(overrides: Partial<FakeTerminal> = {}): XTerm {
	return {
		options: { fontFamily: '"Sarasa Mono", monospace', fontSize: 14 },
		dimensions: { css: { cell: { width: 7, height: 17 } } },
		...overrides,
	} as unknown as XTerm;
}

describe("measureAdvanceWidth", () => {
	beforeEach(() => {
		vi.mocked(getSharedAttachedContext).mockReturnValue(null);
		resetMeasureContext();
	});

	it("reports the configured font's advance, not the fallback's", () => {
		stubCanvas({ "Sarasa Mono": 0.5, fallback: 0.6021 });
		expect(measureAdvanceWidth('"Sarasa Mono", monospace', 14)).toBe(7);
	});

	it("returns null for an empty family", () => {
		stubCanvas({ fallback: 0.6 });
		expect(measureAdvanceWidth("   ", 14)).toBeNull();
	});

	it("returns null for a non-positive font size", () => {
		stubCanvas({ fallback: 0.6 });
		expect(measureAdvanceWidth("monospace", 0)).toBeNull();
	});
});

describe("isCellWidthStale", () => {
	beforeEach(() => {
		vi.mocked(getSharedAttachedContext).mockReturnValue(null);
		resetMeasureContext();
	});

	it("is false when the cached cell width matches the font", () => {
		stubCanvas({ "Sarasa Mono": 0.5 });
		expect(isCellWidthStale(fakeTerminal())).toBe(false);
	});

	it("is true when cols were computed from a fallback measurement", () => {
		// 8.43px is Menlo at 14px — what xterm caches if it measured too early.
		stubCanvas({ "Sarasa Mono": 0.5 });
		const term = fakeTerminal({
			dimensions: { css: { cell: { width: 8.43, height: 17 } } },
		});
		expect(isCellWidthStale(term)).toBe(true);
	});

	it("is false when the font cannot be measured at all", () => {
		stubCanvas({});
		expect(isCellWidthStale(fakeTerminal())).toBe(false);
	});
});

describe("forceCharSizeRemeasure", () => {
	beforeEach(() => {
		vi.mocked(getSharedAttachedContext).mockReturnValue(null);
		resetMeasureContext();
	});

	it("calls xterm's char size service when available", () => {
		const measure = vi.fn();
		const term = fakeTerminal({ _core: { _charSizeService: { measure } } });
		forceCharSizeRemeasure(term);
		expect(measure).toHaveBeenCalledTimes(1);
	});

	it("falls back to nudging fontFamily and restores the original value", () => {
		const seen: string[] = [];
		const options = { fontSize: 14, _family: '"Sarasa Mono", monospace' };
		const term = {
			options: {
				fontSize: 14,
				get fontFamily() {
					return options._family;
				},
				set fontFamily(value: string) {
					options._family = value;
					seen.push(value);
				},
			},
		} as unknown as XTerm;

		forceCharSizeRemeasure(term);

		expect(seen).toHaveLength(2);
		expect(seen[0]).not.toBe(seen[1]);
		expect(term.options.fontFamily).toBe('"Sarasa Mono", monospace');
	});
});

describe("remeasureIfStale", () => {
	beforeEach(() => {
		vi.mocked(getSharedAttachedContext).mockReturnValue(null);
		resetMeasureContext();
	});

	it("skips the re-measure when metrics already agree", () => {
		stubCanvas({ "Sarasa Mono": 0.5 });
		const measure = vi.fn();
		const term = fakeTerminal({ _core: { _charSizeService: { measure } } });
		expect(remeasureIfStale(term)).toBe(false);
		expect(measure).not.toHaveBeenCalled();
	});

	it("re-measures when the cached cell width is stale", () => {
		stubCanvas({ "Sarasa Mono": 0.5 });
		const measure = vi.fn();
		const term = fakeTerminal({
			dimensions: { css: { cell: { width: 8.43, height: 17 } } },
			_core: { _charSizeService: { measure } },
		});
		expect(remeasureIfStale(term)).toBe(true);
		expect(measure).toHaveBeenCalledTimes(1);
	});
});
