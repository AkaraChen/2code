import type { FileDiffMetadata } from "@pierre/diffs";

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
