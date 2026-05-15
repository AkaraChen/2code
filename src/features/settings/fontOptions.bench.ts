import { bench, describe } from "vitest";
import type { SystemFont } from "@/generated";
import { buildMonoFontSelectItems } from "./fontOptions";

const fonts: SystemFont[] = Array.from({ length: 3_000 }, (_, index) => ({
	family: `Font ${index}`,
	is_mono: index % 4 === 0,
}));

function buildWithFilterAndMap(showAllFonts: boolean) {
	const visibleFonts = showAllFonts ? fonts : fonts.filter((font) => font.is_mono);
	return visibleFonts.map((font) => ({
		value: font.family,
		label: font.family,
	}));
}

describe("font select item construction", () => {
	bench("filter plus map mono fonts", () => {
		buildWithFilterAndMap(false);
	});

	bench("single pass mono fonts", () => {
		buildMonoFontSelectItems(fonts);
	});
});
