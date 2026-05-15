import { describe, expect, it } from "vitest";
import type { SystemFont } from "@/generated";
import { buildMonoFontSelectItems } from "./fontOptions";

const fonts: SystemFont[] = [
	{ family: "Mono", is_mono: true },
	{ family: "Sans", is_mono: false },
];

describe("buildMonoFontSelectItems", () => {
	it("keeps only mono fonts", () => {
		expect(buildMonoFontSelectItems(fonts)).toEqual([
			{ value: "Mono", label: "Mono" },
		]);
	});
});
