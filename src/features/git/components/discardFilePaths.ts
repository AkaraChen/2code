import type { FileDiffMetadata } from "@pierre/diffs";

export interface DiscardFilePaths {
	relativePaths: string[];
	filePathsToRefresh: string[];
}

export function buildDiscardFilePaths(
	file: Pick<FileDiffMetadata, "name" | "prevName">,
	worktreePath: string,
	resolvePath: (worktreePath: string, relativePath: string) => string,
): DiscardFilePaths {
	const relativePaths =
		file.prevName && file.prevName !== file.name
			? [file.name, file.prevName]
			: [file.name];
	const filePathsToRefresh = new Array<string>(relativePaths.length);

	for (let index = 0; index < relativePaths.length; index++) {
		filePathsToRefresh[index] = resolvePath(worktreePath, relativePaths[index]);
	}

	return { relativePaths, filePathsToRefresh };
}
