import type { FileDiffMetadata } from "@pierre/diffs";

export const GIT_DIFF_LARGE_FILE_LINE_THRESHOLD = 2000;

export const gitBinaryPreviewSources = {
	workingTree: "working_tree",
	head: "head",
	commit: "commit",
	parentCommit: "parent_commit",
} as const;

export type GitBinaryPreviewSource =
	(typeof gitBinaryPreviewSources)[keyof typeof gitBinaryPreviewSources];

const previewableImageMimeTypes: Record<string, string> = {
	apng: "image/apng",
	avif: "image/avif",
	bmp: "image/bmp",
	cur: "image/x-icon",
	gif: "image/gif",
	ico: "image/x-icon",
	jfif: "image/jpeg",
	jpe: "image/jpeg",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	pjp: "image/jpeg",
	pjpeg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

export const changeBadge: Record<
	string,
	{ label: string; colorPalette: string }
> = {
	new: { label: "A", colorPalette: "green" },
	deleted: { label: "D", colorPalette: "red" },
	change: { label: "M", colorPalette: "blue" },
	"rename-pure": { label: "R", colorPalette: "yellow" },
	"rename-changed": { label: "R", colorPalette: "yellow" },
};

export function getLineStats(file: FileDiffMetadata) {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const content of hunk.hunkContent) {
			if (content.type === "change") {
				additions += content.additions;
				deletions += content.deletions;
			}
		}
	}
	return { additions, deletions };
}

export function getChangedLineCount(file: FileDiffMetadata) {
	const { additions, deletions } = getLineStats(file);
	return additions + deletions;
}

export function isLargeGitDiffFile(
	file: FileDiffMetadata,
	threshold = GIT_DIFF_LARGE_FILE_LINE_THRESHOLD,
) {
	return getChangedLineCount(file) >= threshold;
}

export function getPreviewableImageMimeType(fileName: string) {
	const extension = fileName.split(".").pop()?.toLowerCase();
	if (!extension) {
		return null;
	}

	return previewableImageMimeTypes[extension] ?? null;
}

export function isBinaryImageDiffPreviewable(file: FileDiffMetadata) {
	if (file.hunks.length > 0 || file.type === "rename-pure") {
		return false;
	}

	const previewPaths = [
		getGitBinaryPreviewPath(file, "before"),
		getGitBinaryPreviewPath(file, "after"),
	].filter((path): path is string => path != null);

	return previewPaths.some((path) => getPreviewableImageMimeType(path) != null);
}

export function getGitBinaryPreviewPath(
	file: FileDiffMetadata,
	side: "before" | "after",
) {
	if (side === "before") {
		if (file.type === "new") {
			return null;
		}

		return file.prevName ?? file.name;
	}

	if (file.type === "deleted") {
		return null;
	}

	return file.name;
}

export function getGitBinaryPreviewRevision(
	file: FileDiffMetadata,
	side: "before" | "after",
) {
	if (side === "before") {
		return file.prevObjectId ?? file.prevName ?? file.name;
	}

	return file.newObjectId ?? file.name;
}

export function reconcileIncludedFiles(
	nextFileNames: string[],
	prevIncluded: Set<string>,
	prevFileNames: Set<string>,
) {
	const nextIncluded = new Set<string>();
	const hadPreviousFiles = prevFileNames.size > 0;

	for (const fileName of nextFileNames) {
		if (!hadPreviousFiles || !prevFileNames.has(fileName)) {
			nextIncluded.add(fileName);
			continue;
		}

		if (prevIncluded.has(fileName)) {
			nextIncluded.add(fileName);
		}
	}

	return nextIncluded;
}

export function getOrderedIncludedFileNames(
	files: readonly FileDiffMetadata[],
	includedFileNames: ReadonlySet<string>,
) {
	const orderedFileNames: string[] = [];
	for (const file of files) {
		if (includedFileNames.has(file.name)) {
			orderedFileNames.push(file.name);
		}
	}
	return orderedFileNames;
}
