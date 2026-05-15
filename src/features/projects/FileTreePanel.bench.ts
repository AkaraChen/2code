import { bench, describe } from "vitest";

const paths = Array.from({ length: 25_000 }, (_, index) =>
	`src/Deep/Path/Module${String(25_000 - index).padStart(5, "0")}/Target.ts`,
);
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

describe("file tree path sorting", () => {
	bench("localeCompare with options", () => {
		const sorted = [...paths].sort((left, right) =>
			left.localeCompare(right, undefined, { sensitivity: "base" }),
		);
		if (sorted.length !== paths.length) {
			throw new Error("localeCompare sort lost paths");
		}
	});

	bench("reused Intl.Collator", () => {
		const sorted = [...paths].sort(collator.compare);
		if (sorted.length !== paths.length) {
			throw new Error("collator sort lost paths");
		}
	});
});
