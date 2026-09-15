import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyHerdrFrameAction,
	HerdrFrameCursor,
	herdrFrameBytes,
	type HerdrFrameView,
	type HerdrXtermSurface,
} from "./herdrFrames";

interface FrameFixture {
	record: {
		seq: number;
		full: boolean;
		width: number;
		height: number;
		bytes: string;
	};
}

function loadFrame(name: string): HerdrFrameView {
	const path = resolve(
		"src-tauri/crates/infra/tests/fixtures/herdr/frames",
		name,
	);
	const fixture = JSON.parse(readFileSync(path, "utf8")) as FrameFixture;
	return {
		seq: fixture.record.seq,
		full: fixture.record.full,
		bytes: Array.from(Buffer.from(fixture.record.bytes, "base64")),
	};
}

function asText(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("latin1");
}

describe("herdrFrameBytes", () => {
	it("copies byte values without UTF-8-decoding the chunk", () => {
		const frame = loadFrame("full-redraw.json");
		const bytes = herdrFrameBytes(frame);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(Array.from(bytes)).toEqual(Array.from(frame.bytes));
		expect(typeof bytes).not.toBe("string");
	});
});

describe("HerdrFrameCursor", () => {
	it("treats a verified full frame as a replacement surface", () => {
		const cursor = new HerdrFrameCursor();
		const frame = loadFrame("full-redraw.json");
		const action = cursor.apply(frame);
		expect(frame.full).toBe(true);
		expect(action?.kind).toBe("replace");
		expect(action && asText(action.bytes)).toContain("\x1b[2J");
		expect(action && asText(action.bytes)).toContain("\x1b[?2026h");
		expect(action && asText(action.bytes)).toContain("\x1b[1;1H");
	});

	it("treats a verified incremental frame as an append", () => {
		const cursor = new HerdrFrameCursor();
		cursor.apply(loadFrame("full-redraw.json"));
		const frame = loadFrame("incremental.json");
		const action = cursor.apply(frame);
		expect(frame.full).toBe(false);
		expect(action?.kind).toBe("append");
		expect(action && asText(action.bytes)).toContain("INCR_LINE_XYZ");
		expect(action && asText(action.bytes)).not.toContain("\x1b[2J");
	});

	it("ignores duplicate and older seq on the same stream", () => {
		const cursor = new HerdrFrameCursor();
		const full = loadFrame("full-redraw.json");
		const incr = loadFrame("incremental.json");
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

function recordingSurface(): HerdrXtermSurface & {
	resets: number;
	writes: Uint8Array[];
} {
	const writes: Uint8Array[] = [];
	return {
		resets: 0,
		writes,
		reset() {
			this.resets += 1;
		},
		write(data, callback) {
			writes.push(data);
			callback?.();
		},
	};
}

describe("applyHerdrFrameAction", () => {
	it("resets the surface before writing a verified full frame", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		const action = cursor.apply(loadFrame("full-redraw.json"));
		expect(action).not.toBeNull();
		applyHerdrFrameAction(surface, action!);
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(1);
		expect(surface.writes[0]).toBeInstanceOf(Uint8Array);
		expect(asText(surface.writes[0]!)).toContain("\x1b[2J");
	});

	it("appends a verified incremental frame without resetting", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		applyHerdrFrameAction(surface, cursor.apply(loadFrame("full-redraw.json"))!);
		applyHerdrFrameAction(surface, cursor.apply(loadFrame("incremental.json"))!);
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(2);
		expect(asText(surface.writes[1]!)).toContain("INCR_LINE_XYZ");
		expect(asText(surface.writes[1]!)).not.toContain("\x1b[2J");
	});

	it("does not write ignored seq values", () => {
		const cursor = new HerdrFrameCursor();
		const surface = recordingSurface();
		const full = loadFrame("full-redraw.json");
		const first = cursor.apply(full);
		expect(first).not.toBeNull();
		applyHerdrFrameAction(surface, first!);
		expect(cursor.apply(full)).toBeNull();
		expect(surface.resets).toBe(1);
		expect(surface.writes).toHaveLength(1);
	});
});
