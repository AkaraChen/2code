import { bench } from "vitest";
import { getPathBasename } from "./path";

const PATHS = [
	"/repo/src/index.ts",
	"/repo/src/features/projects/FileViewerPane.tsx",
	"README.md",
	"/Users/example/Developer/2code/src-tauri/src/lib.rs",
	"/repo/src/",
	"",
];

function getPathBasenameWithSplit(path: string) {
	return path.split("/").pop() ?? path;
}

bench("split path basename", () => {
	let total = 0;
	for (const path of PATHS) {
		total += getPathBasenameWithSplit(path).length;
	}
	if (total < 0) throw new Error("unreachable");
});

bench("lastIndexOf path basename", () => {
	let total = 0;
	for (const path of PATHS) {
		total += getPathBasename(path).length;
	}
	if (total < 0) throw new Error("unreachable");
});
