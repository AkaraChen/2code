import { beforeEach, describe, expect, it } from "vitest";
import {
	BORDER_RADIUS_MAP,
	type BorderRadius,
	useThemeStore,
} from "./themeStore";

function resetStore() {
	useThemeStore.setState({ borderRadius: "sm" });
	localStorage.clear();
}

function getState() {
	return useThemeStore.getState();
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

	it("maps non-none values to restrained native-style radii", () => {
		expect(BORDER_RADIUS_MAP.sm).toEqual({
			l1: "4px",
			l2: "5px",
			l3: "6px",
		});
		expect(BORDER_RADIUS_MAP.md).toEqual({
			l1: "5px",
			l2: "6px",
			l3: "8px",
		});
		expect(BORDER_RADIUS_MAP.lg).toEqual({
			l1: "6px",
			l2: "8px",
			l3: "10px",
		});
		expect(BORDER_RADIUS_MAP.xl).toEqual({
			l1: "8px",
			l2: "10px",
			l3: "12px",
		});
	});
});

describe("useThemeStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("borderRadius defaults to 'sm'", () => {
			expect(getState().borderRadius).toBe("sm");
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
			expect(style.getPropertyValue("--chakra-radii-l1")).toBe("6px");
			expect(style.getPropertyValue("--chakra-radii-l2")).toBe("8px");
			expect(style.getPropertyValue("--chakra-radii-l3")).toBe("10px");
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
			expect(style.getPropertyValue("--chakra-radii-l1")).toBe("8px");
			expect(style.getPropertyValue("--chakra-radii-l2")).toBe("10px");
			expect(style.getPropertyValue("--chakra-radii-l3")).toBe("12px");
		});
	});
});
