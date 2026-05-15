import { bench, describe } from "vitest";
import { splitDiffFilePath } from "./filePath";

const paths = [
	"src/features/git/components/FileListItem.tsx",
	"src/features/projects/FileViewerPane.tsx",
	"src-tauri/crates/infra/src/git.rs",
	"README.md",
	"package.json",
	"apps/web/src/routes/settings/profile/page.tsx",
];

function splitDiffFilePathWithSplit(name: string) {
	const basename = name.split("/").pop() ?? name;
	const parentPath = name.includes("/")
		? name.split("/").slice(0, -1).join("/")
		: null;
	return { basename, parentPath };
}

describe("diff file path splitting", () => {
	bench("split with lastIndexOf", () => {
		for (const path of paths) {
			splitDiffFilePath(path);
		}
	});

	bench("split twice", () => {
		for (const path of paths) {
			splitDiffFilePathWithSplit(path);
		}
	});
});
