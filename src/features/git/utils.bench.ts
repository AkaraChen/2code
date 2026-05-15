import { bench, describe } from "vitest";
import type { FileDiffMetadata } from "@pierre/diffs";
import { getOrderedIncludedFileNames } from "./utils";

const files = Array.from({ length: 5_000 }, (_, index) => ({
	name: `src/file-${index}.ts`,
	type: "change",
	hunks: [],
}) as unknown as FileDiffMetadata);
const includedFileNames = new Set(
	files.filter((_, index) => index % 2 === 0).map((file) => file.name),
);

function getOrderedIncludedFileNamesWithFlatMap(
	values: readonly FileDiffMetadata[],
	included: ReadonlySet<string>,
) {
	return values.flatMap((file) =>
		included.has(file.name) ? [file.name] : [],
	);
}

describe("ordered included git files", () => {
	bench("collect included files directly", () => {
		getOrderedIncludedFileNames(files, includedFileNames);
	});

	bench("collect included files with flatMap", () => {
		getOrderedIncludedFileNamesWithFlatMap(files, includedFileNames);
	});
});
