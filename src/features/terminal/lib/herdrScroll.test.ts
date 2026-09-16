import { describe, expect, it } from "vitest";
import { herdrPageScroll, herdrWheelScroll } from "./herdrScroll";

describe("herdrWheelScroll", () => {
	it("maps pixel wheel deltas to terminal.scroll with lines > 0", () => {
		expect(herdrWheelScroll({ deltaY: -80 })).toEqual({
			direction: "up",
			lines: 2,
			source: "wheel",
		});
		expect(herdrWheelScroll({ deltaY: 40 })).toEqual({
			direction: "down",
			lines: 1,
			source: "wheel",
		});
		expect(herdrWheelScroll({ deltaY: -10 })).toEqual({
			direction: "up",
			lines: 1,
			source: "wheel",
		});
	});

	it("ignores empty or non-finite deltas", () => {
		expect(herdrWheelScroll({ deltaY: 0 })).toBeNull();
		expect(herdrWheelScroll({ deltaY: Number.NaN })).toBeNull();
	});
});

describe("herdrPageScroll", () => {
	it("maps PageUp/PageDown to pageKey scroll with the visible row count", () => {
		expect(herdrPageScroll("PageUp", 32)).toEqual({
			direction: "up",
			lines: 32,
			source: "pageKey",
		});
		expect(herdrPageScroll("PageDown", 24)).toEqual({
			direction: "down",
			lines: 24,
			source: "pageKey",
		});
		expect(herdrPageScroll("PageUp", 0)).toEqual({
			direction: "up",
			lines: 1,
			source: "pageKey",
		});
	});

	it("ignores unrelated keys", () => {
		expect(herdrPageScroll("ArrowUp", 24)).toBeNull();
	});
});
