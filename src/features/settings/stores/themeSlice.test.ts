import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./index";
import {
	ACCENT_COLORS,
	BORDER_RADIUS_MAP,
	type BorderRadius,
} from "./themeSlice";

function resetStore() {
	useSettingsStore.setState({ accentColor: "blue", borderRadius: "sm" });
	localStorage.clear();
}

function getState() {
	return useSettingsStore.getState();
}

describe("bORDER_RADIUS_MAP", () => {
	it("contains entries for all BorderRadius values", () => {
		const keys: BorderRadius[] = ["none", "sm", "md", "lg", "xl"];
		for (const key of keys) {
			expect(BORDER_RADIUS_MAP[key]).toBeDefined();
		}
	});

	it("each entry has l1, l2, l3 string values", () => {
		for (const entry of Object.values(BORDER_RADIUS_MAP)) {
			expect(typeof entry.l1).toBe("string");
			expect(typeof entry.l2).toBe("string");
			expect(typeof entry.l3).toBe("string");
		}
	});

	it("'none' maps all levels to '0'", () => {
		expect(BORDER_RADIUS_MAP.none).toEqual({
			l1: "0",
			l2: "0",
			l3: "0",
		});
	});

	it("values increase from sm to xl", () => {
		const parseRem = (v: string) => Number.parseFloat(v);
		const sizes: BorderRadius[] = ["sm", "md", "lg", "xl"];
		for (let i = 1; i < sizes.length; i++) {
			const prev = BORDER_RADIUS_MAP[sizes[i - 1]];
			const curr = BORDER_RADIUS_MAP[sizes[i]];
			expect(parseRem(curr.l1)).toBeGreaterThan(parseRem(prev.l1));
		}
	});
});

describe("themeSlice", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("accentColor defaults to 'blue'", () => {
			expect(getState().accentColor).toBe("blue");
		});

		it("borderRadius defaults to 'sm'", () => {
			expect(getState().borderRadius).toBe("sm");
		});
	});

	describe("setAccentColor", () => {
		it("updates accentColor", () => {
			getState().setAccentColor("red");
			expect(getState().accentColor).toBe("red");
		});

		it("accepts all valid accent colors", () => {
			for (const color of ACCENT_COLORS) {
				getState().setAccentColor(color);
				expect(getState().accentColor).toBe(color);
			}
		});
	});

	describe("setBorderRadius", () => {
		it("updates borderRadius", () => {
			getState().setBorderRadius("lg");
			expect(getState().borderRadius).toBe("lg");
		});

		it("syncs CSS variables on document.documentElement", () => {
			getState().setBorderRadius("lg");
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--chakra-radii-l1")).toBe("0.5rem");
			expect(style.getPropertyValue("--chakra-radii-l2")).toBe("0.75rem");
			expect(style.getPropertyValue("--chakra-radii-l3")).toBe("1rem");
		});

		it("syncs CSS variables for 'none'", () => {
			getState().setBorderRadius("none");
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--chakra-radii-l1")).toBe("0");
			expect(style.getPropertyValue("--chakra-radii-l2")).toBe("0");
			expect(style.getPropertyValue("--chakra-radii-l3")).toBe("0");
		});

		it("syncs CSS variables for 'xl'", () => {
			getState().setBorderRadius("xl");
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--chakra-radii-l1")).toBe("0.75rem");
			expect(style.getPropertyValue("--chakra-radii-l2")).toBe("1rem");
			expect(style.getPropertyValue("--chakra-radii-l3")).toBe("1.5rem");
		});
	});
});
