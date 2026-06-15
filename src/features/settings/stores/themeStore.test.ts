import { beforeEach, describe, expect, it } from "vitest";
import {
	BORDER_RADIUS_MAP,
	type BorderRadius,
	migrateThemePersistedState,
	useThemeStore,
} from "./themeStore";

function resetStore() {
	useThemeStore.setState({ borderRadius: "sm", windowOpacity: 100 });
	localStorage.clear();
	document.documentElement.style.removeProperty("--app-window-bg-alpha");
}

function getState() {
	return useThemeStore.getState();
}

describe("border radius map", () => {
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

		it("windowOpacity defaults to 100", () => {
			expect(getState().windowOpacity).toBe(100);
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

	describe("setWindowOpacity", () => {
		it("updates windowOpacity", () => {
			getState().setWindowOpacity(37);
			expect(getState().windowOpacity).toBe(37);
		});

		it("syncs background alpha on document.documentElement", () => {
			getState().setWindowOpacity(60);
			const style = document.documentElement.style;
			expect(style.getPropertyValue("--app-window-bg-alpha")).toBe("0.6");
		});

		it("normalizes opacity to an integer percentage between 0 and 100", () => {
			getState().setWindowOpacity(1000);
			expect(getState().windowOpacity).toBe(100);

			getState().setWindowOpacity(-10);
			expect(getState().windowOpacity).toBe(0);

			getState().setWindowOpacity(33.6);
			expect(getState().windowOpacity).toBe(34);
		});
	});
});

describe("migrateThemePersistedState", () => {
	it("defaults missing windowOpacity to 100", () => {
		expect(migrateThemePersistedState({ borderRadius: "lg" })).toEqual({
			borderRadius: "lg",
			windowOpacity: 100,
		});
	});

	it("keeps valid persisted windowOpacity values", () => {
		expect(
			migrateThemePersistedState({
				borderRadius: "md",
				windowOpacity: 37,
			}),
		).toEqual({
			borderRadius: "md",
			windowOpacity: 37,
		});
	});

	it("normalizes invalid persisted values", () => {
		expect(
			migrateThemePersistedState({
				borderRadius: "massive",
				windowOpacity: "transparent",
			}),
		).toEqual({
			borderRadius: "sm",
			windowOpacity: 100,
		});
	});

	it("clamps out-of-range persisted windowOpacity values", () => {
		expect(
			migrateThemePersistedState({
				borderRadius: "md",
				windowOpacity: 120,
			}),
		).toEqual({
			borderRadius: "md",
			windowOpacity: 100,
		});

		expect(
			migrateThemePersistedState({
				borderRadius: "md",
				windowOpacity: -20,
			}),
		).toEqual({
			borderRadius: "md",
			windowOpacity: 0,
		});
	});
});
