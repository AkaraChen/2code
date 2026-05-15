import { bench, describe } from "vitest";
import { pathBasename } from "./path";

const paths = [
	"src/features/projects/FileViewerPane.tsx",
	"src-tauri/crates/infra/src/filesystem.rs",
	"README.md",
	"apps/web/src/routes/settings/profile/page.tsx",
	"/Users/akrc/Developer/2code/package.json",
];

function basenameWithSplit(path: string) {
	return path.split("/").pop() ?? "";
}

describe("path basename", () => {
	bench("basename with lastIndexOf", () => {
		for (const path of paths) {
			pathBasename(path);
		}
	});

	bench("basename with split", () => {
		for (const path of paths) {
			basenameWithSplit(path);
		}
	});
});
