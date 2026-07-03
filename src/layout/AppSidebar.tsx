import { CheckIcon, DotsSixVerticalIcon, FolderIcon, GearSixIcon, HouseIcon, PencilSimpleLineIcon, PlusIcon, StarIcon } from "@phosphor-icons/react";
import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayoutGroup } from "motion/react";
import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { matchPath, useLocation } from "react-router";
import { toast } from "sonner";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@/components/ui/sidebar";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import {
	useProjectGroups,
	useProjects,
	useUpdateProjectSidebarLayout,
} from "@/features/projects/hooks";
import type { ProjectWithProfiles } from "@/generated";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages.js";
import { SidebarLink } from "@/shared/components/SidebarLink";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { isMacPlatform } from "@/shared/lib/platform";
import { ProjectAvatar } from "./sidebar/ProjectAvatar";
import { ProjectGroupSection } from "./sidebar/ProjectGroupSection";
import { ProjectMenuItem } from "./sidebar/ProjectMenuItem";
import {
	buildSidebarLayout,
	createSidebarLayoutUpdates,
	groupDropId,
	groupEntryId,
	parseDropId,
	parseEntryId,
	PINNED_DROP_ID,
	projectEntryId,
	type SidebarContainerId,
	type SidebarEntryId,
	type SidebarLayoutState,
	type SidebarTopEntry,
	toSidebarLayoutState,
	TOP_LEVEL_DROP_ID,
} from "./sidebar/sidebarLayout";
import {
	APP_SIDEBAR_MAX_WIDTH,
	APP_SIDEBAR_MIN_WIDTH,
	useAppSidebarStore,
} from "./sidebarStore";

const IS_MAC_PLATFORM = isMacPlatform();

function insertAt<T>(items: T[], item: T, index: number) {
	const next = [...items];
	next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
	return next;
}

function removeProjectFromState(
	state: SidebarLayoutState,
	projectId: string,
): SidebarLayoutState {
	return {
		pinnedProjectIds: state.pinnedProjectIds.filter((id) => id !== projectId),
		topEntryIds: state.topEntryIds.filter(
			(id) => id !== projectEntryId(projectId),
		),
		groupProjectIds: new Map(
			Array.from(state.groupProjectIds.entries()).map(([groupId, ids]) => [
				groupId,
				ids.filter((id) => id !== projectId),
			]),
		),
	};
}

function removeGroupFromState(
	state: SidebarLayoutState,
	groupId: string,
): SidebarLayoutState {
	return {
		...state,
		topEntryIds: state.topEntryIds.filter((id) => id !== groupEntryId(groupId)),
	};
}

function getProjectContainer(project: ProjectWithProfiles): SidebarContainerId {
	if (project.pinned_order != null) return "pinned";
	if (project.group_id) return `group:${project.group_id}`;
	return "top-level";
}

function getOverContainer(
	overId: string,
	model: ReturnType<typeof buildSidebarLayout>,
	activeKind: "group" | "project",
): SidebarContainerId | null {
	const dropContainer = parseDropId(overId);
	if (dropContainer) return dropContainer;

	const parsed = parseEntryId(overId);
	if (!parsed) return null;

	if (parsed.kind === "group") {
		return activeKind === "group" ? "top-level" : `group:${parsed.id}`;
	}

	const project = model.projectById.get(parsed.id);
	return project ? getProjectContainer(project) : null;
}

function getInsertIndex(
	container: SidebarContainerId,
	overId: string,
	state: SidebarLayoutState,
) {
	const parsed = parseEntryId(overId);
	if (!parsed) return Number.POSITIVE_INFINITY;

	if (container === "pinned" && parsed.kind === "project") {
		const index = state.pinnedProjectIds.indexOf(parsed.id);
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	}

	if (container === "top-level") {
		const index = state.topEntryIds.indexOf(overId as SidebarEntryId);
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	}

	if (container.startsWith("group:") && parsed.kind === "project") {
		const groupId = container.slice("group:".length);
		const index = state.groupProjectIds.get(groupId)?.indexOf(parsed.id) ?? -1;
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	}

	return Number.POSITIVE_INFINITY;
}

function SidebarDropZone({
	id,
	label,
	compact,
}: { id: string; label: string; compact?: boolean }) {
	const { isOver, setNodeRef } = useDroppable({ id });

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"mx-3 rounded-md border border-dashed px-3 text-center text-xs text-muted-foreground",
				compact ? "my-1 py-1" : "my-2 py-2",
				isOver ? "border-foreground/30 bg-muted" : "border-border",
			)}
		>
			{label}
		</div>
	);
}

function SortableProjectRow({
	project,
	isPinned,
	onTogglePinned,
	disabled,
}: {
	project: ProjectWithProfiles;
	isPinned: boolean;
	onTogglePinned: (project: ProjectWithProfiles) => void;
	disabled?: boolean;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: projectEntryId(project.id), disabled });

	return (
		<SidebarMenuItem
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.45 : 1,
			}}
		>
			<SidebarMenuButton
				{...attributes}
				data-sidebar-item
				className={cn(isDragging && "bg-sidebar-accent")}
			>
				<span
					{...listeners}
					className={cn(
						"grid shrink-0 place-items-center text-muted-foreground",
						disabled ? "cursor-default" : "cursor-grab",
					)}
				>
					<DotsSixVerticalIcon />
				</span>
				<ProjectAvatar projectId={project.id} projectName={project.name} />
				<span>{project.name}</span>
			</SidebarMenuButton>
			<SidebarMenuAction
				aria-label={isPinned ? m.unpinProject() : m.pinProject()}
				disabled={disabled}
				aria-pressed={isPinned}
				onClick={() => onTogglePinned(project)}
			>
				<StarIcon />
			</SidebarMenuAction>
		</SidebarMenuItem>
	);
}

function SortableGroupRow({
	entry,
	disabled,
	children,
}: {
	entry: Extract<SidebarTopEntry, { kind: "group" }>;
	disabled?: boolean;
	children?: React.ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: entry.id, disabled });

	return (
		<SidebarMenuItem
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.45 : 1,
			}}
		>
			<SidebarMenuButton
				{...attributes}
				data-sidebar-item
				className={cn(isDragging && "bg-sidebar-accent")}
			>
				<span
					{...listeners}
					className={cn(
						"grid shrink-0 place-items-center text-muted-foreground",
						disabled ? "cursor-default" : "cursor-grab",
					)}
				>
					<DotsSixVerticalIcon />
				</span>
				<FolderIcon />
				<span>{entry.group.name}</span>
			</SidebarMenuButton>
			<SidebarMenuBadge>{entry.projects.length}</SidebarMenuBadge>
			{children}
		</SidebarMenuItem>
	);
}

export default function AppSidebar() {
	const { data: projects } = useProjects();
	const { data: projectGroups } = useProjectGroups();
	const location = useLocation();
	const createDialog = useDialogState();
	const navRef = useRef<HTMLDivElement>(null);
	const isLayoutSaveInFlightRef = useRef(false);
	const [isSidebarLayoutSaving, setIsSidebarLayoutSaving] = useState(false);
	const updateSidebarLayout = useUpdateProjectSidebarLayout();
	const isReorderMode = useAppSidebarStore((s) => s.isReorderMode);
	const toggleReorderMode = useAppSidebarStore((s) => s.toggleReorderMode);
	const sidebarWidth = useAppSidebarStore((s) => s.width);
	const setSidebarWidth = useAppSidebarStore((s) => s.setWidth);
	const resize = useHorizontalResize({
		value: sidebarWidth,
		min: APP_SIDEBAR_MIN_WIDTH,
		max: APP_SIDEBAR_MAX_WIDTH,
		onChange: setSidebarWidth,
	});
	const sidebarLayout = useMemo(
		() => buildSidebarLayout(projects, projectGroups),
		[projectGroups, projects],
	);
	const activeProfileId = useMemo(
		() =>
			matchPath("/projects/:id/profiles/:profileId", location.pathname)
				?.params.profileId ?? null,
		[location.pathname],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const persistLayoutState = useCallback(
		async (state: SidebarLayoutState) => {
			if (isLayoutSaveInFlightRef.current) return;

			isLayoutSaveInFlightRef.current = true;
			setIsSidebarLayoutSaving(true);
			const updates = createSidebarLayoutUpdates(state);
			try {
				await updateSidebarLayout.mutateAsync(updates);
			} catch (error) {
				toast.error(m.sidebarOrderUpdateFailed(), {
					description:
						error instanceof Error ? error.message : String(error),
				});
			} finally {
				isLayoutSaveInFlightRef.current = false;
				setIsSidebarLayoutSaving(false);
			}
		},
		[updateSidebarLayout],
	);

	const handleTogglePinned = useCallback(
		(project: ProjectWithProfiles) => {
			if (isLayoutSaveInFlightRef.current) return;

			const state = removeProjectFromState(
				toSidebarLayoutState(sidebarLayout),
				project.id,
			);
			if (project.pinned_order == null) {
				state.pinnedProjectIds = [...state.pinnedProjectIds, project.id];
			} else {
				state.topEntryIds = [
					...state.topEntryIds,
					projectEntryId(project.id),
				];
			}
			void persistLayoutState(state);
		},
		[persistLayoutState, sidebarLayout],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			if (isLayoutSaveInFlightRef.current) return;

			const { active, over } = event;
			if (!over) return;

			const activeId = String(active.id);
			const overId = String(over.id);
			if (activeId === overId) return;
			const activeEntry = parseEntryId(activeId);
			if (!activeEntry) return;

			const targetContainer = getOverContainer(
				overId,
				sidebarLayout,
				activeEntry.kind,
			);
			if (!targetContainer) return;

			const baseState = toSidebarLayoutState(sidebarLayout);
			let nextState =
				activeEntry.kind === "project"
					? removeProjectFromState(baseState, activeEntry.id)
					: removeGroupFromState(baseState, activeEntry.id);
			const insertIndex = getInsertIndex(targetContainer, overId, nextState);

			if (activeEntry.kind === "group") {
				if (targetContainer !== "top-level") return;
				nextState = {
					...nextState,
					topEntryIds: insertAt(
						nextState.topEntryIds,
						groupEntryId(activeEntry.id),
						insertIndex,
					),
				};
			} else if (targetContainer === "pinned") {
				nextState = {
					...nextState,
					pinnedProjectIds: insertAt(
						nextState.pinnedProjectIds,
						activeEntry.id,
						insertIndex,
					),
				};
			} else if (targetContainer === "top-level") {
				nextState = {
					...nextState,
					topEntryIds: insertAt(
						nextState.topEntryIds,
						projectEntryId(activeEntry.id),
						insertIndex,
					),
				};
			} else {
				const groupId = targetContainer.slice("group:".length);
				const groupProjectIds = new Map(nextState.groupProjectIds);
				groupProjectIds.set(
					groupId,
					insertAt(
						groupProjectIds.get(groupId) ?? [],
						activeEntry.id,
						insertIndex,
					),
				);
				nextState = { ...nextState, groupProjectIds };
			}

			void persistLayoutState(nextState);
		},
		[persistLayoutState, sidebarLayout],
	);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

		const nav = navRef.current;
		if (!nav) return;

		const items = Array.from(
			nav.querySelectorAll<HTMLElement>("[data-sidebar-item]"),
		);
		if (items.length === 0) return;

		const currentIndex = items.indexOf(
			document.activeElement as HTMLElement,
		);

		const nextIndex =
			e.key === "ArrowDown"
				? currentIndex === -1
					? 0
					: (currentIndex + 1) % items.length
				: currentIndex === -1
					? items.length - 1
					: (currentIndex - 1 + items.length) % items.length;

		items[nextIndex]?.focus();
		e.preventDefault();
	}, []);

	return (
		<>
			<SidebarProvider
				className="h-full min-h-0 w-auto shrink-0"
				style={
					{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties
				}
			>
				<Sidebar
					ref={navRef}
					role="navigation"
					aria-label={m.sideNavLabel()}
					collapsible="none"
					className="relative min-h-0 shrink-0 border-r"
					onKeyDown={handleKeyDown}
				>
					<LayoutGroup id="app-sidebar">
						<SidebarHeader
							data-tauri-drag-region
							className={cn(
								"shrink-0",
								IS_MAC_PLATFORM ? "pt-7" : "pt-2",
							)}
						>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										size="lg"
										className="pointer-events-none"
									>
										<span className="font-semibold">2Code</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarHeader>
						<SidebarContent className="overflow-x-hidden [scrollbar-gutter:stable]">
							{projects.length === 0 && (
								<SidebarGroup>
									<SidebarGroupContent>
										<SidebarMenu>
											<SidebarLink to="/" icon={<HouseIcon />}>
												{m.home()}
											</SidebarLink>
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							)}

							{isReorderMode ? (
								<>
									<SidebarGroup>
										<SidebarGroupLabel>
											{m.pinnedProjects()}
										</SidebarGroupLabel>
										<SidebarGroupContent>
											<DndContext
												sensors={sensors}
												collisionDetection={closestCenter}
												onDragEnd={handleDragEnd}
											>
												<SidebarMenu>
													<SortableContext
														items={sidebarLayout.pinnedProjects.map(
															(project) =>
																projectEntryId(project.id),
														)}
														strategy={verticalListSortingStrategy}
													>
														{sidebarLayout.pinnedProjects.map(
															(project) => (
																<SortableProjectRow
																	key={project.id}
																	project={project}
																	isPinned
																	onTogglePinned={
																		handleTogglePinned
																	}
																	disabled={
																		isSidebarLayoutSaving
																	}
																/>
															),
														)}
													</SortableContext>
												</SidebarMenu>
												<SidebarDropZone
													id={PINNED_DROP_ID}
													label={m.dropHereToPin()}
													compact={
														sidebarLayout.pinnedProjects
															.length > 0
													}
												/>
											</DndContext>
										</SidebarGroupContent>
									</SidebarGroup>

									<SidebarGroup>
										<SidebarGroupLabel>
											<span>{m.sidebarProjectsSection()}</span>
											<SidebarGroupAction
												aria-label={m.doneEditingProjectOrder()}
												aria-pressed={isReorderMode}
												disabled={isSidebarLayoutSaving}
												className="right-9 bg-sidebar-accent text-sidebar-accent-foreground"
												onClick={toggleReorderMode}
											>
												<CheckIcon weight="regular" />
											</SidebarGroupAction>
											<SidebarGroupAction
												id="add-project-button"
												aria-label={m.newProject()}
												onClick={createDialog.onOpen}
											>
												<PlusIcon weight="regular" />
											</SidebarGroupAction>
										</SidebarGroupLabel>
										<SidebarGroupContent>
											<DndContext
												sensors={sensors}
												collisionDetection={closestCenter}
												onDragEnd={handleDragEnd}
											>
												<SidebarMenu>
													<SortableContext
														items={sidebarLayout.topEntries.map(
															(entry) => entry.id,
														)}
														strategy={verticalListSortingStrategy}
													>
														{sidebarLayout.topEntries.map((entry) =>
															entry.kind === "group" ? (
																<SortableGroupRow
																	key={entry.id}
																	entry={entry}
																	disabled={
																		isSidebarLayoutSaving
																	}
																>
																	<SidebarMenu className="pl-4">
																		<SortableContext
																			items={entry.projects.map(
																				(project) =>
																					projectEntryId(
																						project.id,
																					),
																			)}
																			strategy={
																				verticalListSortingStrategy
																			}
																		>
																			{entry.projects.map(
																				(project) => (
																					<SortableProjectRow
																						key={project.id}
																						project={project}
																						isPinned={false}
																						onTogglePinned={
																							handleTogglePinned
																						}
																						disabled={
																							isSidebarLayoutSaving
																						}
																					/>
																				),
																			)}
																		</SortableContext>
																	</SidebarMenu>
																	<SidebarDropZone
																		id={groupDropId(
																			entry.group.id,
																		)}
																		label={m.dropProjectIntoFolder()}
																		compact
																	/>
																</SortableGroupRow>
															) : (
																<SortableProjectRow
																	key={entry.id}
																	project={entry.project}
																	isPinned={false}
																	onTogglePinned={
																		handleTogglePinned
																	}
																	disabled={
																		isSidebarLayoutSaving
																	}
																/>
															),
														)}
													</SortableContext>
												</SidebarMenu>
												<SidebarDropZone
													id={TOP_LEVEL_DROP_ID}
													label={m.dropHereToUnpinOrMoveOut()}
												/>
											</DndContext>
										</SidebarGroupContent>
									</SidebarGroup>
								</>
							) : (
								<>
										{sidebarLayout.pinnedProjects.length > 0 && (
											<SidebarGroup>
												<SidebarGroupLabel>
													{m.pinnedProjects()}
												</SidebarGroupLabel>
												<SidebarGroupContent>
													<SidebarMenu>
														{sidebarLayout.pinnedProjects.map(
															(project) => (
																<ProjectMenuItem
																	key={project.id}
																	project={project}
																	projectGroups={projectGroups}
																	activeProfileId={activeProfileId}
																/>
															),
														)}
													</SidebarMenu>
												</SidebarGroupContent>
											</SidebarGroup>
										)}

										<SidebarGroup>
											<SidebarGroupLabel>
												<span>{m.sidebarProjectsSection()}</span>
												<SidebarGroupAction
													aria-label={m.editProjectOrder()}
													aria-pressed={isReorderMode}
													disabled={isSidebarLayoutSaving}
													className="right-9"
													onClick={toggleReorderMode}
												>
													<PencilSimpleLineIcon weight="regular" />
												</SidebarGroupAction>
												<SidebarGroupAction
													id="add-project-button"
													aria-label={m.newProject()}
													onClick={createDialog.onOpen}
												>
													<PlusIcon weight="regular" />
												</SidebarGroupAction>
											</SidebarGroupLabel>
											<SidebarGroupContent>
												<SidebarMenu>
													{sidebarLayout.topEntries.map((entry) =>
														entry.kind === "group" ? (
															<ProjectGroupSection
																key={entry.group.id}
																group={entry.group}
																projectGroups={projectGroups}
																projects={entry.projects}
																activeProfileId={activeProfileId}
															/>
														) : (
															<ProjectMenuItem
																key={entry.project.id}
																project={entry.project}
																projectGroups={projectGroups}
																activeProfileId={activeProfileId}
															/>
														),
													)}
												</SidebarMenu>
											</SidebarGroupContent>
										</SidebarGroup>
									</>
								)}
						</SidebarContent>
						<SidebarFooter className="shrink-0">
							<SidebarMenu>
								<SidebarLink to="/settings" icon={<GearSixIcon />}>
									{m.settings()}
								</SidebarLink>
							</SidebarMenu>
						</SidebarFooter>
					</LayoutGroup>
					<div
						role="separator"
						aria-label="Resize sidebar"
						aria-orientation="vertical"
						aria-valuemin={APP_SIDEBAR_MIN_WIDTH}
						aria-valuemax={APP_SIDEBAR_MAX_WIDTH}
						aria-valuenow={sidebarWidth}
						tabIndex={0}
						className={cn(
							"absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize before:absolute before:top-0 before:bottom-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:transition-colors hover:before:bg-border focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--app-focus-ring) focus-visible:before:bg-border",
							resize.isDragging
								? "before:bg-foreground/30"
								: "before:bg-transparent",
						)}
						onPointerDown={resize.handlePointerDown}
						onKeyDown={resize.handleKeyDown}
					/>
				</Sidebar>
			</SidebarProvider>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
