import {
	Box,
	Circle,
	CloseButton,
	Flex,
	HStack,
	Spinner,
	Tabs,
} from "@chakra-ui/react";
import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useReducedMotion } from "motion/react";
import { lazy, Suspense, useMemo } from "react";
import { FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import { useCloseFileTabFlow } from "@/features/projects/useCloseFileTabFlow";
import { getFileIconUrl } from "@/shared/lib/fileIcons";
import {
	buildSortableId,
	FILE_SORTABLE_PREFIX,
	resolveSortableReorder,
	TERMINAL_SORTABLE_PREFIX,
} from "./tabSorting";
import { useCloseTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import TerminalTemplateMenu from "./TerminalTemplateMenu";
import { Terminal } from "./Terminal";

const FileViewerPane = lazy(() => import("@/features/projects/FileViewerPane"));
const DiffTabPane = lazy(() => import("@/features/git/DiffTabPane"));
const CommitDetailPane = lazy(
	() => import("@/features/git/CommitDetailPane"),
);

// Stable fallbacks — module-level constants prevent new object refs each render,
// which would break useShallow's equality check and cause infinite re-renders.
const EMPTY_TERMINAL_PROFILE = { tabs: [] as { id: string; title: string }[], activeTabId: null as string | null };
const EMPTY_FILE_PROFILE = { tabs: [] as { filePath: string; title: string }[], activeFilePath: null as string | null, fileTabActive: false };
const EMPTY_DIRTY_FILE_PATHS: string[] = [];
const TAB_ANIMATION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;
const TAB_EXIT_ANIMATION = {
	duration: 0.14,
	ease: [0.4, 0, 1, 1],
} as const;
const TAB_MIN_WIDTH = "140px";
const FULL_TAB_MOTION_PROPS = {
	initial: { opacity: 0, scale: 0.92, y: 6 },
	animate: { opacity: 1, scale: 1, y: 0 },
	exit: { opacity: 0, scale: 0.88, y: -6, width: 0 },
	transition: { default: TAB_ANIMATION, opacity: TAB_EXIT_ANIMATION },
} as const;

interface TabTriggerProps {
	value: string;
	icon: React.ReactNode;
	title: string;
	maxTitleLength: number;
	badge?: React.ReactNode;
	onClose: () => void;
}

function TabTrigger({
	value,
	icon,
	title,
	maxTitleLength,
	badge,
	onClose,
}: TabTriggerProps) {
	const displayTitle = title.length > maxTitleLength
		? `${title.slice(0, maxTitleLength)}...`
		: title;

	return (
		<Tabs.Trigger value={value} flexShrink={0} minW={TAB_MIN_WIDTH}>
			{icon}
			<HStack gap="2" flex="1" minW="0">
				<Box as="span" minW="0" flex="1" flexShrink={1}>
					{displayTitle}
				</Box>
				{badge}
				<CloseButton
					as="span"
					role="button"
					size="2xs"
					flexShrink={0}
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onClose();
					}}
				/>
			</HStack>
		</Tabs.Trigger>
	);
}

interface SortableTabItemProps extends TabTriggerProps {
	sortableId: string;
	motionProps: Record<string, unknown>;
}

function SortableTabItem({
	sortableId,
	// motionProps intentionally unused — entry/exit animations conflict
	// with dnd-kit's own transform animation during reorder. The
	// sortable's transform/transition handles the "slide into place"
	// feel after a drop on its own.
	motionProps: _motionProps,
	...props
}: SortableTabItemProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: sortableId });

	// One animated element only: dnd-kit's transform + transition live on
	// the same node that owns setNodeRef + listeners + attributes. No outer
	// motion.div, no AnimatePresence — both fight dnd-kit over `transform`
	// and produce the "tab jumps to wrong slot after drop" bug.
	return (
		<Box
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				display: "flex",
				flexShrink: 0,
				minWidth: 0,
				overflow: "hidden",
				transformOrigin: "left center",
				opacity: isDragging ? 0.45 : 1,
				zIndex: isDragging ? 1 : 0,
			}}
			{...attributes}
			{...listeners}
			cursor={isDragging ? "grabbing" : "grab"}
		>
			<TabTrigger {...props} />
		</Box>
	);
}

interface TerminalTabsProps {
	projectId: string;
	profileId: string;
	cwd: string;
}

export default function TerminalTabs({
	projectId,
	profileId,
	cwd,
}: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_TERMINAL_PROFILE),
	);
	// Scope to this profile's tabs only — avoids re-rendering on unrelated PTY notifications
	const notifiedTabIds = useTerminalStore(
		useShallow((state) => {
			const profile = state.profiles[profileId];
			if (!profile) return [] as string[];
			return profile.tabs
				.filter((tab) => state.notifiedTabs.has(tab.id))
				.map((tab) => tab.id);
		}),
	);
	const notifiedTabSet = useMemo(
		() => new Set(notifiedTabIds),
		[notifiedTabIds],
	);
	const reorderTerminalTabs = useTerminalStore((state) => state.reorderTabs);
	const setActiveTab = useTerminalStore((state) => state.setActiveTab);

	const fileViewerState = useFileViewerTabsStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_FILE_PROFILE),
	);
	const dirtyFilePaths = useFileViewerDirtyStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_DIRTY_FILE_PATHS),
	);
	const closeFileTabFlow = useCloseFileTabFlow(profileId);
	const reorderFileTabs = useFileViewerTabsStore((state) => state.reorderTabs);
	const setFileActive = useFileViewerTabsStore((state) => state.setFileActive);
	const setTerminalActive = useFileViewerTabsStore((state) => state.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;
	const dirtyFilePathSet = useMemo(
		() => new Set(dirtyFilePaths),
		[dirtyFilePaths],
	);

	const closeTab = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);
	const terminalSortableItems = useMemo(
		() =>
			tabs.map((tab) => ({
				...tab,
				sortableId: buildSortableId(TERMINAL_SORTABLE_PREFIX, tab.id),
			})),
		[tabs],
	);
	const fileSortableItems = useMemo(
		() =>
			fileTabs.map((tab) => ({
				...tab,
				sortableId: buildSortableId(FILE_SORTABLE_PREFIX, tab.filePath),
			})),
		[fileTabs],
	);

	// Unified active tab value: file path when a file tab is active, session ID otherwise
	const activeValue = fileTabActive
		? (activeFilePath ?? "")
		: (activeTabId ?? "");
	const tabMotionProps = prefersReducedMotion ? {} : FULL_TAB_MOTION_PROPS;

	function handleTabChange(value: string) {
		const isFileTab = fileTabs.some((tab) => tab.filePath === value);
		if (isFileTab) {
			setFileActive(profileId, value);
		} else {
			setActiveTab(profileId, value);
			setTerminalActive(profileId);
		}
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const reorderRequest = resolveSortableReorder(
			String(active.id),
			String(over.id),
			tabs.map((tab) => tab.id),
			fileTabs.map((tab) => tab.filePath),
		);
		if (!reorderRequest) return;

		if (reorderRequest.kind === TERMINAL_SORTABLE_PREFIX) {
			reorderTerminalTabs(
				profileId,
				reorderRequest.fromIndex,
				reorderRequest.toIndex,
			);
			return;
		}

		reorderFileTabs(
			profileId,
			reorderRequest.fromIndex,
			reorderRequest.toIndex,
		);
	}

	if (tabs.length === 0 && fileTabs.length === 0) return null;

	return (
		<Flex direction="column" h="full" w="full" minW="0">
			<Tabs.Root
				size="sm"
				w="full"
				minW="0"
				value={activeValue}
				onValueChange={(event) => handleTabChange(event.value)}
			>
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<Box overflowX="auto" overflowY="hidden" w="full" minW="0">
						<Tabs.List w="full" minW="max-content">
							<SortableContext
								items={terminalSortableItems.map((tab) => tab.sortableId)}
								strategy={horizontalListSortingStrategy}
							>
								{terminalSortableItems.map((tab) => (
									<SortableTabItem
										key={tab.id}
										sortableId={tab.sortableId}
										value={tab.id}
										icon={<FiTerminal />}
										title={tab.title}
										maxTitleLength={10}
										motionProps={tabMotionProps}
										badge={
											notifiedTabSet.has(tab.id) &&
											tab.id !== activeTabId ? (
												<Circle size="2" bg="green.500" />
											) : undefined
										}
										onClose={() =>
											closeTab.mutate({
												profileId,
												sessionId: tab.id,
											})
										}
									/>
								))}
							</SortableContext>

							<SortableContext
								items={fileSortableItems.map((tab) => tab.sortableId)}
								strategy={horizontalListSortingStrategy}
							>
								{fileSortableItems.map((tab) => (
									<SortableTabItem
										key={tab.filePath}
										sortableId={tab.sortableId}
										value={tab.filePath}
										icon={
											<img
												src={getFileIconUrl(tab.title)}
												width={14}
												height={14}
												alt=""
												draggable={false}
											/>
										}
										title={tab.title}
										maxTitleLength={14}
										motionProps={tabMotionProps}
										badge={
											dirtyFilePathSet.has(tab.filePath) ? (
												<Circle size="2" bg="fg.muted" />
											) : undefined
										}
										onClose={() =>
											void closeFileTabFlow(tab.filePath)
										}
									/>
								))}
							</SortableContext>

							<TerminalTemplateMenu
								profileId={profileId}
								cwd={cwd}
								projectId={projectId}
							/>
						</Tabs.List>
					</Box>
				</DndContext>
			</Tabs.Root>

			{/* File viewer — static content, safe to conditionally render */}
			{fileTabActive && activeFilePath && (
				<Box flex="1" minH="0" overflow="hidden">
					<Suspense
						fallback={(
							<Flex align="center" justify="center" h="32">
								<Spinner size="sm" />
							</Flex>
						)}
					>
						{activeFilePath.startsWith("2code-diff://") ? (
							<DiffTabPane
								tabPath={activeFilePath}
								profileId={profileId}
							/>
						) : activeFilePath.startsWith("2code-commit://") ? (
							<CommitDetailPane
								tabPath={activeFilePath}
								profileId={profileId}
							/>
						) : (
							<FileViewerPane filePath={activeFilePath} profileId={profileId} />
						)}
					</Suspense>
				</Box>
			)}

			{/* Terminal area — NEVER unmounted, hidden via CSS when file tab is active */}
			<Box
				flex="1"
				minH="0"
				position="relative"
				display={fileTabActive ? "none" : "block"}
			>
				{tabs.map((tab) => (
					<Box
						key={tab.id}
						position="absolute"
						inset="0"
						visibility={tab.id === activeTabId ? "visible" : "hidden"}
						pointerEvents={tab.id === activeTabId ? "auto" : "none"}
						aria-hidden={tab.id !== activeTabId}
					>
						<Terminal
							profileId={profileId}
							sessionId={tab.id}
							isActive={tab.id === activeTabId && !fileTabActive}
						/>
					</Box>
				))}
			</Box>
		</Flex>
	);
}
