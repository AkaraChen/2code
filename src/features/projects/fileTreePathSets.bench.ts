import { bench, describe } from "vitest";
import { buildFilePathSet } from "./fileTreePathSets";

const existingPathSet = new Set<string>();

for (let index = 0; index < 30_000; index++) {
	existingPathSet.add(`src/features/module-${index}/`);
	existingPathSet.add(`src/features/module-${index}/file-${index}.ts`);
}

function buildWithArrayFilter() {
	return new Set(
		[...existingPathSet].filter((path) => !path.endsWith("/")),
	);
}

describe("file tree file path set construction", () => {
	bench("array filter then set", () => {
		buildWithArrayFilter();
	});

	bench("direct set fill", () => {
		buildFilePathSet(existingPathSet);
	});
});
