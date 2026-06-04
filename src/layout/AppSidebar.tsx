import { Box, Flex, HStack, Icon, IconButton, Text } from "@chakra-ui/react";
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
import { useCallback, useMemo, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router";
import {
	FiCheck,
	FiEdit3,
	FiFolder,
	FiHome,
	FiPlus,
	FiSettings,
	FiStar,
} from "react-icons/fi";
import { PiDotsSixVerticalBold } from "react-icons/pi";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import {
	useProjectGroups,
	useProjects,
	useUpdateProjectSidebarLayout,
} from "@/features/projects/hooks";
import type { ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { SidebarLink } from "@/shared/components/SidebarLink";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { isMacPlatform } from "@/shared/lib/platform";
import { toaster } from "@/shared/providers/appToaster";
import { ProjectGroupSection } from "./sidebar/ProjectGroupSection";
import { ProjectAvatar } from "./sidebar/ProjectAvatar";
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

function getProjectContainer(
	project: ProjectWithProfiles,
): SidebarContainerId {
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
}: {
	id: string;
	label: string;
	compact?: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({ id });
	return (
		<Box
			ref={setNodeRef}
			mx="3"
			my={compact ? "1" : "2"}
			px="3"
			py={compact ? "1" : "2"}
			borderWidth="1px"
			borderStyle="dashed"
			borderColor={isOver ? "border.emphasized" : "border.subtle"}
			bg={isOver ? "bg.muted" : "transparent"}
			color="fg.subtle"
			fontSize="xs"
			borderRadius="md"
			textAlign="center"
		>
			{label}
		</Box>
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
		<HStack
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.45 : 1,
			}}
			{...attributes}
			data-sidebar-item
			tabIndex={0}
			gap="2"
			align="center"
			w="full"
			minW="0"
			px="4"
			py="1.5"
			userSelect="none"
			bg={isDragging ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
		>
			<Box
				{...listeners}
				w="5"
				h="5"
				display="grid"
				placeItems="center"
				color="fg.subtle"
				cursor={disabled ? "default" : "grab"}
				flexShrink={0}
			>
				<PiDotsSixVerticalBold />
			</Box>
			<ProjectAvatar projectId={project.id} projectName={project.name} />
			<Text flex="1 1 auto" minW="0" truncate lineHeight="1.25rem">
				{project.name}
			</Text>
			<IconButton
				aria-label={isPinned ? m.unpinProject() : m.pinProject()}
				variant={isPinned ? "solid" : "ghost"}
				colorPalette={isPinned ? "yellow" : undefined}
				size="2xs"
				flexShrink={0}
				disabled={disabled}
				onClick={() => onTogglePinned(project)}
			>
				<FiStar />
			</IconButton>
		</HStack>
	);
}

function SortableGroupRow({
	entry,
	disabled,
}: {
	entry: Extract<SidebarTopEntry, { kind: "group" }>;
	disabled?: boolean;
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
		<HStack
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.45 : 1,
			}}
			{...attributes}
			data-sidebar-item
			tabIndex={0}
			gap="2"
			align="center"
			w="full"
			minW="0"
			px="4"
			py="1.5"
			color="fg.muted"
			fontSize="xs"
			fontWeight="semibold"
			textTransform="uppercase"
			userSelect="none"
			bg={isDragging ? "bg.subtle" : "transparent"}
			_hover={{ bg: "bg.subtle" }}
		>
			<Box
				{...listeners}
				w="5"
				h="5"
				display="grid"
				placeItems="center"
				color="fg.subtle"
				cursor={disabled ? "default" : "grab"}
				flexShrink={0}
			>
				<PiDotsSixVerticalBold />
			</Box>
			<Icon fontSize="sm" flexShrink={0}>
				<FiFolder />
			</Icon>
			<Text flex="1 1 auto" minW="0" truncate>
				{entry.group.name}
			</Text>
			<Text color="fg.subtle">{entry.projects.length}</Text>
		</HStack>
		);
	}

export default function AppSidebar() {
	const { data: projects } = useProjects();
	const { data: projectGroups } = useProjectGroups();
	const location = useLocation();
	const createDialog = useDialogState();
	const navRef = useRef<HTMLElement>(null);
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
				toaster.create({
					title: m.sidebarOrderUpdateFailed(),
					description:
						error instanceof Error ? error.message : String(error),
					type: "error",
					closable: true,
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

		let nextIndex: number;
		if (e.key === "ArrowDown") {
			nextIndex =
				currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
		} else {
			nextIndex =
				currentIndex === -1
					? items.length - 1
					: (currentIndex - 1 + items.length) % items.length;
		}

		items[nextIndex]?.focus();
		e.preventDefault();
	}, []);

	return (
		<>
			<Box
				as="nav"
				ref={navRef}
				aria-label={m.sideNavLabel()}
				w="var(--sidebar-width)"
				h="full"
				minH="0"
				flexShrink={0}
				position="relative"
				bg="bg"
				borderRightWidth="1px"
				borderColor="border.muted"
				onKeyDown={handleKeyDown}
			>
				<LayoutGroup id="app-sidebar">
					<Flex direction="column" h="full" minH="0" w="full">
						<Flex
							data-tauri-drag-region
							h={IS_MAC_PLATFORM ? "66px" : "48px"}
							flexShrink={0}
							align="center"
							justify="start"
							paddingInline="4"
							pt={IS_MAC_PLATFORM ? "5" : "2"}
						>
							<Text
								fontWeight="600"
								color="fg"
								fontSize="sm"
								userSelect="none"
								pointerEvents="none"
								whiteSpace="nowrap"
							>
								2Code
							</Text>
						</Flex>
						<Box
							flex="1"
							minH="0"
							overflowY="scroll"
							overflowX="hidden"
							css={{ scrollbarGutter: "stable" }}
						>
							<Flex
								direction="column"
								minH="full"
								w="full"
								minW="0"
								css={{
									"& > *": {
										flexShrink: 0,
									},
								}}
							>
							{projects.length === 0 && (
								<SidebarLink
									to="/"
									icon={<FiHome />}
									style={{ marginBottom: 20 }}
								>
									{m.home()}
								</SidebarLink>
							)}

							<HStack
								px="4"
								pt="2"
								pb="2"
								align="center"
								gap="1"
								w="full"
								minW="0"
								userSelect="none"
							>
								<HStack gap="2" flex="1 1 auto" minW="0">
									<Box
										w="5"
										h="5"
										ml="-0.5"
										display="grid"
										placeItems="center"
										flexShrink={0}
										aria-hidden="true"
									>
										<Icon
											fontSize="sm"
											color="fg.muted"
											flexShrink={0}
										>
											<FiFolder />
										</Icon>
									</Box>
									<Text
										fontSize="xs"
										fontWeight="semibold"
										lineHeight="1rem"
										transform="translateY(1px)"
										color="fg.muted"
										textTransform="uppercase"
										letterSpacing="wider"
										truncate
									>
										{m.projects()}
									</Text>
								</HStack>
								<IconButton
									aria-label={
										isReorderMode
											? m.doneEditingProjectOrder()
											: m.editProjectOrder()
									}
									variant={isReorderMode ? "solid" : "ghost"}
									size="2xs"
									flexShrink={0}
									disabled={isSidebarLayoutSaving}
									onClick={toggleReorderMode}
								>
									{isReorderMode ? <FiCheck /> : <FiEdit3 />}
								</IconButton>
								<IconButton
									id="add-project-button"
									aria-label={m.newProject()}
									variant="ghost"
									size="2xs"
									flexShrink={0}
									onClick={createDialog.onOpen}
								>
									<FiPlus />
								</IconButton>
							</HStack>

							{isReorderMode ? (
								<DndContext
									sensors={sensors}
									collisionDetection={closestCenter}
									onDragEnd={handleDragEnd}
								>
									<Text
										px="4"
										pt="1"
										pb="1"
										fontSize="xs"
										color="fg.subtle"
									>
										{m.pinnedProjects()}
									</Text>
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
									<SidebarDropZone
										id={PINNED_DROP_ID}
										label={m.dropHereToPin()}
										compact={
											sidebarLayout.pinnedProjects
												.length > 0
										}
									/>

									<Text
										px="4"
										pt="2"
										pb="1"
										fontSize="xs"
										color="fg.subtle"
									>
										{m.sidebarProjectsSection()}
									</Text>
									<SortableContext
										items={sidebarLayout.topEntries.map(
											(entry) => entry.id,
										)}
										strategy={verticalListSortingStrategy}
									>
										{sidebarLayout.topEntries.map(
											(entry) =>
												entry.kind === "group" ? (
													<Box key={entry.id}>
														<SortableGroupRow
															entry={entry}
															disabled={
																isSidebarLayoutSaving
															}
														/>
														<Box ps="4">
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
																	(
																		project,
																	) => (
																		<SortableProjectRow
																			key={
																				project.id
																			}
																			project={
																				project
																			}
																			isPinned={
																				false
																			}
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
															<SidebarDropZone
																id={groupDropId(
																	entry.group
																		.id,
																)}
																label={m.dropProjectIntoFolder()}
																compact
															/>
														</Box>
													</Box>
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
									<SidebarDropZone
										id={TOP_LEVEL_DROP_ID}
										label={m.dropHereToUnpinOrMoveOut()}
									/>
								</DndContext>
							) : (
								<>
									{sidebarLayout.pinnedProjects.length > 0 && (
										<>
											<Text
												px="4"
												pt="1"
												pb="1"
												fontSize="xs"
												color="fg.subtle"
												textTransform="uppercase"
												fontWeight="semibold"
											>
												{m.pinnedProjects()}
											</Text>
											{sidebarLayout.pinnedProjects.map(
												(project) => (
													<ProjectMenuItem
														key={project.id}
														project={project}
														projectGroups={
															projectGroups
														}
														activeProfileId={
															activeProfileId
														}
													/>
												),
											)}
										</>
									)}
									{sidebarLayout.topEntries.map((entry) =>
										entry.kind === "group" ? (
											<ProjectGroupSection
												key={entry.group.id}
												group={entry.group}
												projectGroups={projectGroups}
												projects={entry.projects}
												activeProfileId={
													activeProfileId
												}
											/>
										) : (
											<ProjectMenuItem
												key={entry.project.id}
												project={entry.project}
												projectGroups={projectGroups}
												activeProfileId={
													activeProfileId
												}
											/>
										),
									)}
								</>
							)}
							</Flex>
						</Box>
						<Box flexShrink={0} pb="3">
							<SidebarLink to="/settings" icon={<FiSettings />}>
								{m.settings()}
							</SidebarLink>
						</Box>
					</Flex>
				</LayoutGroup>
				<Box
					role="separator"
					aria-label="Resize sidebar"
					aria-orientation="vertical"
					aria-valuemin={APP_SIDEBAR_MIN_WIDTH}
					aria-valuemax={APP_SIDEBAR_MAX_WIDTH}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					position="absolute"
					top="0"
					right="-4px"
					bottom="0"
					w="8px"
					cursor="col-resize"
					zIndex={1}
					onPointerDown={resize.handlePointerDown}
					onKeyDown={resize.handleKeyDown}
					_before={{
						content: '""',
						position: "absolute",
						top: 0,
						bottom: 0,
						left: "50%",
						transform: "translateX(-50%)",
						width: "1px",
						bg: resize.isDragging
							? "border.emphasized"
							: "transparent",
						transition: "background-color 0.16s ease",
					}}
					_hover={{
						_before: {
							bg: "border.subtle",
						},
					}}
					_focusVisible={{
						outline: "2px solid",
						outlineColor: "var(--app-focus-ring)",
						outlineOffset: "-2px",
						_before: {
							bg: "border.emphasized",
						},
					}}
				/>
			</Box>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
