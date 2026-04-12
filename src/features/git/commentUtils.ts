import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";

type DiffSelectionSide = NonNullable<SelectedLineRange["side"]>;

function buildSelectedLineRange(
	start: number,
	end: number,
	side: SelectedLineRange["side"],
	endSide: SelectedLineRange["endSide"],
): SelectedLineRange {
	const next: SelectedLineRange = { start, end };

	if (side != null) {
		next.side = side;
	}

	if (endSide != null && endSide !== side) {
		next.endSide = endSide;
	}

	return next;
}

function formatSelectionSide(side: DiffSelectionSide) {
	return side === "deletions" ? "deletions" : "additions";
}

export function normalizeSelectedLineRange(
	range: SelectedLineRange,
): SelectedLineRange {
	if (range.start <= range.end) {
		return range;
	}

	return buildSelectedLineRange(
		range.end,
		range.start,
		range.endSide ?? range.side,
		range.side,
	);
}

export function formatSelectedLineRange(range: SelectedLineRange) {
	const normalized = normalizeSelectedLineRange(range);
	const startSide = normalized.side ?? "additions";
	const endSide = normalized.endSide ?? startSide;

	if (startSide === endSide) {
		if (normalized.start === normalized.end) {
			return `${formatSelectionSide(startSide)} ${normalized.start}`;
		}

		return `${formatSelectionSide(startSide)} ${normalized.start}-${normalized.end}`;
	}

	return `${formatSelectionSide(startSide)} ${normalized.start} -> ${formatSelectionSide(endSide)} ${normalized.end}`;
}

export function formatGitDiffCommentLocation(
	file: FileDiffMetadata,
	range: SelectedLineRange,
) {
	return `${file.name}:${formatSelectedLineRange(range)}`;
}

export function formatGitDiffCommentPayload(
	file: FileDiffMetadata,
	range: SelectedLineRange,
	comment: string,
) {
	const trimmedComment = comment.trim();

	return [
		`File: ${file.name}`,
		`Selection: ${formatSelectedLineRange(range)}`,
		`Comment: ${trimmedComment}`,
	].join("\n");
}

export function getGitDiffCommentAnchor(range: SelectedLineRange) {
	const normalized = normalizeSelectedLineRange(range);

	return {
		lineNumber: normalized.start,
		side: (normalized.side ?? "additions") as DiffSelectionSide,
	};
}

export function getGitDiffCommentFileKey(
	file: FileDiffMetadata,
	contextKey: string,
) {
	return [
		contextKey,
		file.prevName ?? "",
		file.name,
		file.type,
	].join("::");
}
