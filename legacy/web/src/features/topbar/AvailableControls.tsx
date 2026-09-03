import { useDroppable } from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import { useMemo } from "react";
import * as m from "@/paraglide/messages.js";
import { DraggableControl } from "./DraggableControl";
import { controlRegistry } from "./registry";
import type { ControlId } from "./types";

interface AvailableControlsProps {
	activeControls: ControlId[];
	supportedControls: ControlId[];
}

export function AvailableControls({
	activeControls,
	supportedControls,
}: AvailableControlsProps) {
	const activeControlSet = useMemo(
		() => new Set(activeControls),
		[activeControls],
	);
	const available = useMemo(
		() => supportedControls.filter((id) => !activeControlSet.has(id)),
		[activeControlSet, supportedControls],
	);
	const { setNodeRef } = useDroppable({ id: "available-area" });

	return (
		<div>
			<div className="mb-2 text-sm font-medium">
				{m.topbarAvailable()}
			</div>
			<SortableContext
				items={available}
				strategy={horizontalListSortingStrategy}
			>
				<div
					ref={setNodeRef}
					className="flex min-h-12 items-center gap-2 rounded-lg border border-dashed p-3"
				>
					{available.length === 0 ? (
						<div className="text-xs text-muted-foreground">
							{m.topbarAllControlsActive()}
						</div>
					) : (
						available.map((id) => {
							const def = controlRegistry.get(id);
							if (!def) return null;
							return (
								<DraggableControl key={id} definition={def} />
							);
						})
					)}
				</div>
			</SortableContext>
		</div>
	);
}
