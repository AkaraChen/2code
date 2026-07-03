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
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import * as m from "@/paraglide/messages.js";
import { getErrorMessage } from "@/shared/lib/errors";
import { launchAppLabels } from "./appLabels";
import { AvailableControls } from "./AvailableControls";
import { DraggableControl } from "./DraggableControl";
import { useSupportedTopbarAppIds } from "./hooks";
import { controlRegistry, getSupportedControlIds } from "./registry";
import { useTopBarStore } from "./store";
import { TopBarPreview } from "./TopBarPreview";
import {
	type ControlId,
	isEditorAppId,
	isTerminalAppId,
} from "./types";

export function TopBarSettings() {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const setActiveControls = useTopBarStore((s) => s.setActiveControls);
	const resetToDefaults = useTopBarStore((s) => s.resetToDefaults);
	const editorApp = useTopBarStore((s) => s.editorApp);
	const setEditorApp = useTopBarStore((s) => s.setEditorApp);
	const terminalApp = useTopBarStore((s) => s.terminalApp);
	const setTerminalApp = useTopBarStore((s) => s.setTerminalApp);
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
	const installedEditorApps = useMemo(
		() => supportedAppIds.filter(isEditorAppId),
		[supportedAppIds],
	);
	const installedTerminalApps = useMemo(
		() => supportedAppIds.filter(isTerminalAppId),
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
	const visibleActiveControlSet = useMemo(
		() => new Set(visibleActiveControls),
		[visibleActiveControls],
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

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id as ControlId);
	}, []);

	const handleDragEnd = useCallback((event: DragEndEvent) => {
		setActiveId(null);
		const { active, over } = event;
		if (!over) return;

		const activeControlId = active.id as ControlId;
		const overControlId = over.id as string;
		const isActiveInPreview = visibleActiveControlSet.has(
			activeControlId,
		);
		const isOverPreviewArea =
			overControlId === "preview-area" ||
			visibleActiveControlSet.has(overControlId as ControlId);
		const isOverAvailableArea =
			overControlId === "available-area" ||
			(!visibleActiveControlSet.has(overControlId as ControlId) &&
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
	}, [
		setActiveControls,
		visibleActiveControls,
		visibleActiveControlSet,
	]);

	const activeDef = useMemo(
		() => (activeId ? controlRegistry.get(activeId) : null),
		[activeId],
	);

	if (isPending) {
		return (
			<p className="text-sm text-muted-foreground">
				{m.topbarDetectingApps()}
			</p>
		);
	}

	if (isError) {
		return (
			<p className="text-sm text-muted-foreground">
				{getErrorMessage(error)}
			</p>
		);
	}

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<p className="text-sm text-muted-foreground">
				{m.topbarDragHint()}
			</p>
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
			<div className="flex flex-col gap-3">
				{installedEditorApps.length > 0 && (
					<label className="flex items-center justify-between gap-4">
						<span className="text-sm font-medium">
							{m.topbarEditorApp()}
						</span>
						<NativeSelect
							size="sm"
							value={
								installedEditorApps.includes(editorApp)
									? editorApp
									: installedEditorApps[0]
							}
							onChange={(e) => {
								const value = e.target.value;
								if (isEditorAppId(value)) setEditorApp(value);
							}}
						>
							{installedEditorApps.map((id) => (
								<NativeSelectOption key={id} value={id}>
									{launchAppLabels[id]()}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</label>
				)}
				{installedTerminalApps.length > 0 && (
					<label className="flex items-center justify-between gap-4">
						<span className="text-sm font-medium">
							{m.topbarTerminalApp()}
						</span>
						<NativeSelect
							size="sm"
							value={
								installedTerminalApps.includes(terminalApp)
									? terminalApp
									: installedTerminalApps[0]
							}
							onChange={(e) => {
								const value = e.target.value;
								if (isTerminalAppId(value)) setTerminalApp(value);
							}}
						>
							{installedTerminalApps.map((id) => (
								<NativeSelectOption key={id} value={id}>
									{launchAppLabels[id]()}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</label>
				)}
			</div>
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onClick={resetToDefaults}
			>
				{m.topbarResetDefaults()}
			</Button>
		</div>
	);
}
