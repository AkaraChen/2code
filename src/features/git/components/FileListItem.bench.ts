import { bench, describe } from "vitest";
import { getFileNameParts } from "./FileListItem";

const fileNames = Array.from({ length: 10_000 }, (_, index) =>
	index % 5 === 0
		? `README-${index}.md`
		: `src/features/git/components/deep/path/FileListItem-${index}.tsx`,
);
let sink = 0;

function splitFileNameParts(fileName: string) {
	const basename = fileName.split("/").pop() ?? fileName;
	const parentPath = fileName.includes("/")
		? fileName.split("/").slice(0, -1).join("/")
		: null;

	return { basename, parentPath };
}

describe("git file list item path parsing", () => {
	bench("split path twice", () => {
		let totalLength = 0;
		for (const fileName of fileNames) {
			const parts = splitFileNameParts(fileName);
			totalLength += parts.basename.length + (parts.parentPath?.length ?? 0);
		}
		sink = totalLength;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("lastIndexOf path once", () => {
		let totalLength = 0;
		for (const fileName of fileNames) {
			const parts = getFileNameParts(fileName);
			totalLength += parts.basename.length + (parts.parentPath?.length ?? 0);
		}
		sink = totalLength;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
