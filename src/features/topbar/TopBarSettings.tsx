import { Button, Stack, Text } from "@chakra-ui/react";
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useState } from "react";
import * as m from "@/paraglide/messages.js";
import { AvailableControls } from "./AvailableControls";
import { DraggableControl } from "./DraggableControl";
import { TopBarPreview } from "./TopBarPreview";
import { controlRegistry } from "./registry";
import { useTopBarStore } from "./store";
import type { ControlId } from "./types";

export function TopBarSettings() {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const setActiveControls = useTopBarStore((s) => s.setActiveControls);
	const resetToDefaults = useTopBarStore((s) => s.resetToDefaults);
	const [activeId, setActiveId] = useState<ControlId | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	function handleDragStart(event: DragStartEvent) {
		setActiveId(event.active.id as ControlId);
	}

	function handleDragEnd(event: DragEndEvent) {
		setActiveId(null);
		const { active, over } = event;
		if (!over) return;

		const activeControlId = active.id as ControlId;
		const overControlId = over.id as string;
		const isActiveInPreview = activeControls.includes(activeControlId);
		const isOverPreviewArea =
			overControlId === "preview-area" ||
			activeControls.includes(overControlId as ControlId);
		const isOverAvailableArea =
			overControlId === "available-area" ||
			(!activeControls.includes(overControlId as ControlId) &&
				overControlId !== "preview-area");

		if (isActiveInPreview && isOverPreviewArea) {
			// Reorder within preview
			if (activeControlId === overControlId) return;
			const oldIndex = activeControls.indexOf(activeControlId);
			const newIndex = activeControls.indexOf(
				overControlId as ControlId,
			);
			if (newIndex !== -1) {
				setActiveControls(
					arrayMove(activeControls, oldIndex, newIndex),
				);
			}
		} else if (isActiveInPreview && isOverAvailableArea) {
			// Remove from preview
			setActiveControls(
				activeControls.filter((id) => id !== activeControlId),
			);
		} else if (!isActiveInPreview && isOverPreviewArea) {
			// Add to preview
			if (overControlId === "preview-area") {
				setActiveControls([...activeControls, activeControlId]);
			} else {
				const overIndex = activeControls.indexOf(
					overControlId as ControlId,
				);
				const newList = [...activeControls];
				newList.splice(overIndex, 0, activeControlId);
				setActiveControls(newList);
			}
		}
	}

	const activeDef = activeId ? controlRegistry.get(activeId) : null;

	return (
		<Stack gap="6" maxW="2xl">
			<Text fontSize="sm" color="fg.muted">
				{m.topbarDragHint()}
			</Text>
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<TopBarPreview activeControls={activeControls} />
				<AvailableControls activeControls={activeControls} />
				<DragOverlay>
					{activeDef ? (
						<DraggableControl
							definition={activeDef}
							isOverlay
						/>
					) : null}
				</DragOverlay>
			</DndContext>
			<Button
				variant="outline"
				size="sm"
				alignSelf="flex-start"
				onClick={resetToDefaults}
			>
				{m.topbarResetDefaults()}
			</Button>
		</Stack>
	);
}
