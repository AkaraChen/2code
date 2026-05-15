import { bench, describe } from "vitest";
import { collectChangeFileNames } from "./changeFileNames";

const files = Array.from({ length: 5_000 }, (_, index) => ({
	name: `src/file-${index}.ts`,
}));

function collectWithMapThenSet() {
	const names = files.map((file) => file.name);
	const nameSet = new Set(names);
	return { names, nameSet };
}

describe("git change file name collection", () => {
	bench("map then set file names", () => {
		collectWithMapThenSet();
	});

	bench("single pass file names and set", () => {
		collectChangeFileNames(files);
	});
});
