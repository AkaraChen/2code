import { arrayMove } from "@dnd-kit/sortable";
import { bench, describe } from "vitest";
import { getNextTopbarControlsAfterDrag } from "./TopBarSettings";
import type { ControlId } from "./types";

const visibleActiveControls = Array.from(
	{ length: 2_000 },
	(_, index) => `control-${index}` as ControlId,
);
const activeControlId = visibleActiveControls[1_650];
const overControlId = visibleActiveControls[120];
let sink = 0;

function getNextTopbarControlsAfterDragWithIncludes(
	visibleActiveControls: ControlId[],
	activeControlId: ControlId,
	overControlId: string,
) {
	const isActiveInPreview = visibleActiveControls.includes(activeControlId);
	const isOverPreviewArea =
		overControlId === "preview-area" ||
		visibleActiveControls.includes(overControlId as ControlId);
	const isOverAvailableArea =
		overControlId === "available-area" ||
		(!visibleActiveControls.includes(overControlId as ControlId) &&
			overControlId !== "preview-area");

	if (isActiveInPreview && isOverPreviewArea) {
		if (activeControlId === overControlId) return null;
		const oldIndex = visibleActiveControls.indexOf(activeControlId);
		const newIndex = visibleActiveControls.indexOf(
			overControlId as ControlId,
		);
		if (newIndex !== -1) {
			return arrayMove(visibleActiveControls, oldIndex, newIndex);
		}
	} else if (isActiveInPreview && isOverAvailableArea) {
		return visibleActiveControls.filter((id) => id !== activeControlId);
	} else if (!isActiveInPreview && isOverPreviewArea) {
		if (overControlId === "preview-area") {
			return [...visibleActiveControls, activeControlId];
		}
		const overIndex = visibleActiveControls.indexOf(
			overControlId as ControlId,
		);
		const newList = [...visibleActiveControls];
		newList.splice(overIndex, 0, activeControlId);
		return newList;
	}

	return null;
}

describe("topbar drag result", () => {
	bench("includes/indexOf drag result", () => {
		const nextControls = getNextTopbarControlsAfterDragWithIncludes(
			visibleActiveControls,
			activeControlId,
			overControlId,
		);
		sink = nextControls?.length ?? 0;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("reused index drag result", () => {
		const nextControls = getNextTopbarControlsAfterDrag(
			visibleActiveControls,
			activeControlId,
			overControlId,
		);
		sink = nextControls?.length ?? 0;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
