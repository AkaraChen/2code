import type { FileDiffMetadata } from "@pierre/diffs";

interface PatchWithFiles {
	files: FileDiffMetadata[];
}

export function collectPatchFiles(patches: readonly PatchWithFiles[]) {
	let fileCount = 0;
	for (const patch of patches) {
		fileCount += patch.files.length;
	}

	const files = new Array<FileDiffMetadata>(fileCount);
	let index = 0;
	for (const patch of patches) {
		for (const file of patch.files) {
			files[index] = file;
			index += 1;
		}
	}
	return files;
}
