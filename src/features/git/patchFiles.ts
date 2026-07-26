import type { FileDiffMetadata } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";

interface PatchWithFiles {
	files: FileDiffMetadata[];
}

const PARSED_DIFF_CACHE_LIMIT = 20;
export const PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH = 1024 * 1024;
export const PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET = 8 * 1024 * 1024;
const parsedDiffFilesCache = new Map<string, FileDiffMetadata[]>();
let cachedTotalLength = 0;

function collectPatchFiles(patches: readonly PatchWithFiles[]) {
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
	if (diff.length > PARSED_DIFF_CACHE_MAX_ENTRY_LENGTH) {
		return files;
	}

	parsedDiffFilesCache.set(diff, files);
	cachedTotalLength += diff.length;

	while (
		parsedDiffFilesCache.size > PARSED_DIFF_CACHE_LIMIT
		|| cachedTotalLength > PARSED_DIFF_CACHE_TOTAL_LENGTH_BUDGET
	) {
		const oldestKey = parsedDiffFilesCache.keys().next().value;
		if (oldestKey === undefined) break;
		parsedDiffFilesCache.delete(oldestKey);
		cachedTotalLength -= oldestKey.length;
	}

	return files;
}
