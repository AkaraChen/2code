import { bench } from "vitest";
import { hasTreePath } from "./FileTreePanel";

const PATHS = Array.from({ length: 1_000 }, (_, index) =>
	index % 4 === 0 ? `src/module-${index}/` : `src/module-${index}/index.ts`,
);
const PATH_SET = new Set(PATHS);

function hasTreePathWithEagerDirectory(
	pathSet: ReadonlySet<string>,
	path: string,
) {
	const directoryPath = `${path.replace(/[\\/]+$/, "")}/`;
	return pathSet.has(path) || pathSet.has(directoryPath);
}

bench("eager directory tree path lookup", () => {
	let count = 0;
	for (const path of PATHS) {
		if (hasTreePathWithEagerDirectory(PATH_SET, path)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});

bench("exact first tree path lookup", () => {
	let count = 0;
	for (const path of PATHS) {
		if (hasTreePath(PATH_SET, path)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});
