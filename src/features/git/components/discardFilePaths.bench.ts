import { bench, describe } from "vitest";
import { buildDiscardFilePaths } from "./discardFilePaths";

const renamedFile = {
	name: "src/new/path/File.tsx",
	prevName: "src/old/path/File.tsx",
};

const unchangedFile = {
	name: "src/path/File.tsx",
	prevName: "src/path/File.tsx",
};

function resolvePath(worktreePath: string, relativePath: string) {
	return `${worktreePath}/${relativePath}`;
}

function buildWithSet(file: { name: string; prevName?: string | null }) {
	const relativePaths = Array.from(
		new Set(
			[file.name, file.prevName].filter((path): path is string =>
				Boolean(path),
			),
		),
	);
	const absolutePaths = relativePaths.map((path) =>
		resolvePath("/repo", path),
	);
	return { relativePaths, filePathsToRefresh: absolutePaths };
}

describe("discard file path construction", () => {
	bench("set plus map renamed file", () => {
		buildWithSet(renamedFile);
	});

	bench("direct renamed file paths", () => {
		buildDiscardFilePaths(renamedFile, "/repo", resolvePath);
	});

	bench("set plus map unchanged file", () => {
		buildWithSet(unchangedFile);
	});

	bench("direct unchanged file paths", () => {
		buildDiscardFilePaths(unchangedFile, "/repo", resolvePath);
	});
});
