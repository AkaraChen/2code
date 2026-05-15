import { bench, describe } from "vitest";
import type { SearchMatch } from "./useSearch";
import { getMatchedLineNumbers } from "./useSearch";

const matches: SearchMatch[] = Array.from({ length: 10_000 }, (_, index) => ({
	columnIndex: index % 80,
	lineNumber: Math.floor(index / 4) + 1,
}));

function getMatchedLineNumbersWithMap(values: readonly SearchMatch[]) {
	return new Set(values.map((match) => match.lineNumber));
}

describe("matched line number set", () => {
	bench("build set directly", () => {
		getMatchedLineNumbers(matches);
	});

	bench("build set through map", () => {
		getMatchedLineNumbersWithMap(matches);
	});
});
