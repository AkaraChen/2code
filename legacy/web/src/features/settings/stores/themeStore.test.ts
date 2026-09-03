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

	it("each entry has shadcn radius token string values", () => {
		for (const entry of Object.values(BORDER_RADIUS_MAP)) {
			expect(typeof entry.sm).toBe("string");
			expect(typeof entry.md).toBe("string");
			expect(typeof entry.lg).toBe("string");
			expect(typeof entry.xl).toBe("string");
		}
	});

	it("'none' maps all levels to '0'", () => {
		expect(BORDER_RADIUS_MAP.none).toEqual({
			sm: "0",
			md: "0",
			lg: "0",
			xl: "0",
		});
	});

	it("maps non-none values to restrained native-style radii", () => {
		expect(BORDER_RADIUS_MAP.sm).toEqual({
			sm: "4px",
			md: "5px",
			lg: "6px",
			xl: "8px",
		});
		expect(BORDER_RADIUS_MAP.md).toEqual({
			sm: "5px",
			md: "6px",
			lg: "8px",
			xl: "10px",
		});
		expect(BORDER_RADIUS_MAP.lg).toEqual({
			sm: "6px",
			md: "8px",
			lg: "10px",
			xl: "12px",
		});
		expect(BORDER_RADIUS_MAP.xl).toEqual({
			sm: "8px",
			md: "10px",
			lg: "12px",
			xl: "14px",
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
			expect(style.getPropertyValue("--radius")).toBe("10px");
			expect(style.getPropertyValue("--radius-sm")).toBe("6px");
			expect(style.getPropertyValue("--radius-md")).toBe("8px");
			expect(style.getPropertyValue("--radius-lg")).toBe("10px");
			expect(style.getPropertyValue("--radius-xl")).toBe("12px");
		});

		it("syncs CSS variables for 'none'", () => {
			getState().setBorderRadius("none");
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--radius")).toBe("0");
			expect(style.getPropertyValue("--radius-sm")).toBe("0");
			expect(style.getPropertyValue("--radius-md")).toBe("0");
			expect(style.getPropertyValue("--radius-lg")).toBe("0");
			expect(style.getPropertyValue("--radius-xl")).toBe("0");
		});

		it("syncs CSS variables for 'xl'", () => {
			getState().setBorderRadius("xl");
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--radius")).toBe("12px");
			expect(style.getPropertyValue("--radius-sm")).toBe("8px");
			expect(style.getPropertyValue("--radius-md")).toBe("10px");
			expect(style.getPropertyValue("--radius-lg")).toBe("12px");
			expect(style.getPropertyValue("--radius-xl")).toBe("14px");
		});
	});

	it("preserves version 0 persisted theme settings during migration", async () => {
		localStorage.setItem(
			"theme-settings",
			JSON.stringify({
				state: { borderRadius: "xl" },
				version: 0,
			}),
		);

		await useThemeStore.persist.rehydrate();

		expect(getState().borderRadius).toBe("xl");
	});
});
