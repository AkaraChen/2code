import { Button, Stack, Text } from "@chakra-ui/react";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useEffect, useMemo, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { getErrorMessage } from "@/shared/lib/errors";
import { AvailableControls } from "./AvailableControls";
import { DraggableControl } from "./DraggableControl";
import { useSupportedTopbarAppIds } from "./hooks";
import { controlRegistry, getSupportedControlIds } from "./registry";
import { useTopBarStore } from "./store";
import { TopBarPreview } from "./TopBarPreview";
import type { ControlId } from "./types";

export function TopBarSettings() {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const setActiveControls = useTopBarStore((s) => s.setActiveControls);
	const resetToDefaults = useTopBarStore((s) => s.resetToDefaults);
	const [activeId, setActiveId] = useState<ControlId | null>(null);
	const {
		data: supportedAppIds = [],
		error,
		isError,
		isPending,
		isSuccess,
	} = useSupportedTopbarAppIds();

	const supportedControlIds = useMemo(
		() => getSupportedControlIds(supportedAppIds),
		[supportedAppIds],
	);
	const supportedControlIdSet = useMemo(
		() => new Set(supportedControlIds),
		[supportedControlIds],
	);
	const visibleActiveControls = useMemo(
		() => activeControls.filter((id) => supportedControlIdSet.has(id)),
		[activeControls, supportedControlIdSet],
	);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	useEffect(() => {
		if (
			!isSuccess ||
			visibleActiveControls.length === activeControls.length
		) {
			return;
		}
		setActiveControls(visibleActiveControls);
	}, [
		activeControls.length,
		isSuccess,
		setActiveControls,
		visibleActiveControls,
	]);

	function handleDragStart(event: DragStartEvent) {
		setActiveId(event.active.id as ControlId);
	}

	function handleDragEnd(event: DragEndEvent) {
		setActiveId(null);
		const { active, over } = event;
		if (!over) return;

		const activeControlId = active.id as ControlId;
		const overControlId = over.id as string;
		const isActiveInPreview =
			visibleActiveControls.includes(activeControlId);
		const isOverPreviewArea =
			overControlId === "preview-area" ||
			visibleActiveControls.includes(overControlId as ControlId);
		const isOverAvailableArea =
			overControlId === "available-area" ||
			(!visibleActiveControls.includes(overControlId as ControlId) &&
				overControlId !== "preview-area");

		if (isActiveInPreview && isOverPreviewArea) {
			// Reorder within preview
			if (activeControlId === overControlId) return;
			const oldIndex = visibleActiveControls.indexOf(activeControlId);
			const newIndex = visibleActiveControls.indexOf(
				overControlId as ControlId,
			);
			if (newIndex !== -1) {
				setActiveControls(
					arrayMove(visibleActiveControls, oldIndex, newIndex),
				);
			}
		} else if (isActiveInPreview && isOverAvailableArea) {
			// Remove from preview
			setActiveControls(
				visibleActiveControls.filter((id) => id !== activeControlId),
			);
		} else if (!isActiveInPreview && isOverPreviewArea) {
			// Add to preview
			if (overControlId === "preview-area") {
				setActiveControls([...visibleActiveControls, activeControlId]);
			} else {
				const overIndex = visibleActiveControls.indexOf(
					overControlId as ControlId,
				);
				const newList = [...visibleActiveControls];
				newList.splice(overIndex, 0, activeControlId);
				setActiveControls(newList);
			}
		}
	}

	const activeDef = activeId ? controlRegistry.get(activeId) : null;

	if (isPending) {
		return (
			<Text fontSize="sm" color="fg.muted">
				{m.topbarDetectingApps()}
			</Text>
		);
	}

	if (isError) {
		return (
			<Text fontSize="sm" color="fg.muted">
				{getErrorMessage(error)}
			</Text>
		);
	}

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
				<TopBarPreview activeControls={visibleActiveControls} />
				<AvailableControls
					activeControls={visibleActiveControls}
					supportedControls={supportedControlIds}
				/>
				<DragOverlay>
					{activeDef ? (
						<DraggableControl definition={activeDef} isOverlay />
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
