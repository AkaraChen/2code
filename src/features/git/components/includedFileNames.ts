import type { FileDiffMetadata } from "@pierre/diffs";

export function collectOrderedIncludedFileNames(
	files: readonly Pick<FileDiffMetadata, "name">[],
	includedFileNames: ReadonlySet<string>,
): string[] {
	const names: string[] = [];
	for (const file of files) {
		if (includedFileNames.has(file.name)) {
			names.push(file.name);
		}
	}
	return names;
}
