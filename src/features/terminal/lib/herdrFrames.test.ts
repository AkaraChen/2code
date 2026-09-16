import { describe, expect, it } from "vitest";
import {
	applyHerdrFrameAction,
	HerdrFrameCursor,
	herdrFrameBytes,
	type HerdrFrameAction,
	type HerdrXtermSurface,
} from "./herdrFrames";
import {
	herdrFullRedrawFrame,
	herdrIncrementalFrame,
	latin1,
} from "./herdrTestFixtures";

function recordingSurface(): HerdrXtermSurface & {
	resets: number;
	writes: Uint8Array[];
} {
	const writes: Uint8Array[] = [];
	const surface: HerdrXtermSurface & {
		resets: number;
		writes: Uint8Array[];
	} = {
		resets: 0,
		writes,
		reset: () => {
			surface.resets += 1;
		},
		write: (data, callback) => {
			writes.push(data);
			callback?.();
		},
	};
	return surface;
}

function mustApply(
	cursor: HerdrFrameCursor,
	frame: typeof herdrFullRedrawFrame,
): HerdrFrameAction {
	const action = cursor.apply(frame);
	expect(action).not.toBeNull();
	if (!action) {
		throw new Error("expected a Herdr frame action");
	}
	return action;
}

describe("herdrFrameBytes", () => {
	it("copies byte values without UTF-8-decoding the chunk", () => {
		const bytes = herdrFrameBytes(herdrFullRedrawFrame);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(Array.from(bytes)).toEqual(Array.from(herdrFullRedrawFrame.bytes));
		expect(typeof bytes).not.toBe("string");
	});
});

describe("herdrFrameCursor", () => {
	it("treats a verified full frame as a replacement surface", () => {
		const cursor = new HerdrFrameCursor();
		const action = mustApply(cursor, herdrFullRedrawFrame);
		expect(herdrFullRedrawFrame.full).toBe(true);
		expect(action.kind).toBe("replace");
		expect(latin1(action.bytes)).toContain("\x1B[2J");
		expect(latin1(action.bytes)).toContain("\x1B[?2026h");
		expect(latin1(action.bytes)).toContain("\x1B[1;1H");
	});

	it("treats a verified incremental frame as an append", () => {
		const cursor = new HerdrFrameCursor();
		mustApply(cursor, herdrFullRedrawFrame);
		const action = mustApply(cursor, herdrIncrementalFrame);
		expect(herdrIncrementalFrame.full).toBe(false);
		expect(action.kind).toBe("append");
		expect(latin1(action.bytes)).toContain("INCR_LINE_XYZ");
		expect(latin1(action.bytes)).not.toContain("\x1B[2J");
	});

	it("ignores duplicate and older seq on the same stream", () => {
		const cursor = new HerdrFrameCursor();
		const full = herdrFullRedrawFrame;
		const incr = herdrIncrementalFrame;
		expect(cursor.apply(full)?.kind).toBe("replace");
		expect(cursor.apply(full)).toBeNull();
		expect(cursor.apply({ ...incr, seq: full.seq })).toBeNull();
		expect(cursor.apply(incr)?.kind).toBe("append");
		expect(cursor.apply({ ...full, seq: incr.seq })).toBeNull();
		expect(cursor.apply({ ...full, seq: incr.seq + 1 })?.kind).toBe(
			"replace",
		);
	});
});

describe("applyHerdrFrameAction", () => {
	it("resets the surface before writing a verified full frame", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		applyHerdrFrameAction(surface, mustApply(cursor, herdrFullRedrawFrame));
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(1);
		expect(surface.writes[0]).toBeInstanceOf(Uint8Array);
		expect(latin1(surface.writes[0] as Uint8Array)).toContain("\x1B[2J");
	});

	it("appends a verified incremental frame without resetting", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		applyHerdrFrameAction(surface, mustApply(cursor, herdrFullRedrawFrame));
		applyHerdrFrameAction(
			surface,
			mustApply(cursor, herdrIncrementalFrame),
		);
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(2);
		expect(latin1(surface.writes[1] as Uint8Array)).toContain(
			"INCR_LINE_XYZ",
		);
		expect(latin1(surface.writes[1] as Uint8Array)).not.toContain("\x1B[2J");
	});

	it("does not write ignored seq values", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		applyHerdrFrameAction(surface, mustApply(cursor, herdrFullRedrawFrame));
		expect(cursor.apply(herdrFullRedrawFrame)).toBeNull();
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(1);
	});
});
