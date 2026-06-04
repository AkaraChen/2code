import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";

interface PatchWithFiles {
	files: FileDiffMetadata[];
}

const PARSED_DIFF_CACHE_LIMIT = 20;
const parsedDiffFilesCache = new Map<string, FileDiffMetadata[]>();

export function collectPatchFiles(patches: readonly PatchWithFiles[]) {
	let fileCount = 0;
	for (const patch of patches) {
		fileCount += patch.files.length;
	}

	const files = Array.from<FileDiffMetadata>({
		length: fileCount,
	} as ArrayLike<FileDiffMetadata>);
	let index = 0;
	for (const patch of patches) {
		for (const file of patch.files) {
			files[index] = file;
			index += 1;
		}
	}
	return files;
}

export function parseDiffFiles(diff: string) {
	const cached = parsedDiffFilesCache.get(diff);
	if (cached) {
		parsedDiffFilesCache.delete(diff);
		parsedDiffFilesCache.set(diff, cached);
		return cached;
	}

	const files = collectPatchFiles(parsePatchFiles(diff));
	parsedDiffFilesCache.set(diff, files);

	if (parsedDiffFilesCache.size > PARSED_DIFF_CACHE_LIMIT) {
		const oldestKey = parsedDiffFilesCache.keys().next().value;
		if (oldestKey !== undefined) {
			parsedDiffFilesCache.delete(oldestKey);
		}
	}

	return files;
}
