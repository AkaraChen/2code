import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

export interface DiffReviewComment {
	id: string;
	fileName: string;
	displayName: string;
	fileDiff: FileDiffMetadata;
	range: SelectedLineRange;
	selectedText: string;
	body: string;
	createdAt: number;
}

export function formatReviewRange(range: SelectedLineRange) {
	const start = Math.min(range.start, range.end);
	const end = Math.max(range.start, range.end);
	return start === end ? `${start}` : `${start}-${end}`;
}

function getSelectedDiffText(
	file: FileDiffMetadata,
	range: SelectedLineRange,
) {
	const start = Math.min(range.start, range.end);
	const end = Math.max(range.start, range.end);
	const startSide = range.side ?? "additions";
	const endSide = range.endSide ?? startSide;

	if (startSide === endSide) {
		return getSideLines(file, startSide, start, end);
	}

	const deletionText = getSideLines(file, "deletions", start, end);
	const additionText = getSideLines(file, "additions", start, end);
	return [
		deletionText ? `# deletions\n${deletionText}` : "",
		additionText ? `# additions\n${additionText}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function createReviewComment(
	file: FileDiffMetadata,
	range: SelectedLineRange,
	body: string,
): DiffReviewComment {
	const displayName =
		file.prevName && file.prevName !== file.name
			? `${file.prevName} -> ${file.name}`
			: file.name;

	return {
		id: crypto.randomUUID(),
		fileName: file.name,
		displayName,
		fileDiff: file,
		range,
		selectedText: getSelectedDiffText(file, range),
		body,
		createdAt: Date.now(),
	};
}

export function formatReviewCommentsForAgent(
	comments: readonly DiffReviewComment[],
) {
	return [
		"Please address these review comments:",
		"",
		...comments.flatMap((comment, index) => [
			`${index + 1}. ${comment.fileName}:${formatReviewRange(comment.range)}`,
			"Selected diff:",
			"```diff",
			normalizeClipboardBlock(comment.selectedText) ||
				"(no selected text available)",
			"```",
			"Comment:",
			normalizeClipboardBlock(comment.body),
			"",
		]),
	].join("\n");
}

function normalizeClipboardBlock(text: string) {
	const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
	while (lines[0] === "") lines.shift();
	while (lines[lines.length - 1] === "") lines.pop();
	return lines.join("\n");
}

function getSideLines(
	file: FileDiffMetadata,
	side: "additions" | "deletions",
	start: number,
	end: number,
) {
	const lines =
		side === "additions" ? file.additionLines : file.deletionLines;
	return lines
		.slice(Math.max(start - 1, 0), Math.max(end, 0))
		.map((line) => `${side === "additions" ? "+" : "-"}${line.trimEnd()}`)
		.join("\n");
}
