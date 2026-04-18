import {
	Box,
	Circle,
	CloseButton,
	Flex,
	HStack,
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import FileViewerPane from "@/features/projects/FileViewerPane";
import { getFileIconUrl } from "@/shared/lib/fileIcons";
import { useCloseTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import TerminalTemplateMenu from "./TerminalTemplateMenu";
import { Terminal } from "./Terminal";

// Stable fallbacks — module-level constants prevent new object refs each render,
// which would break useShallow's equality check and cause infinite re-renders.
const EMPTY_TERMINAL_PROFILE = { tabs: [] as { id: string; title: string }[], activeTabId: null as string | null };
const EMPTY_FILE_PROFILE = { tabs: [] as { filePath: string; title: string }[], activeFilePath: null as string | null, fileTabActive: false };
const TAB_ANIMATION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;
const TAB_EXIT_ANIMATION = {
	duration: 0.14,
	ease: [0.4, 0, 1, 1],
} as const;
const TAB_MIN_WIDTH = "140px";
const TERMINAL_SORTABLE_PREFIX = "terminal";
const FILE_SORTABLE_PREFIX = "file";
const FULL_TAB_MOTION_PROPS = {
	layout: "position" as const,
	initial: { opacity: 0, scale: 0.92, y: 6 },
	animate: { opacity: 1, scale: 1, y: 0 },
	exit: { opacity: 0, scale: 0.88, y: -6, width: 0 },
	transition: { layout: TAB_ANIMATION, default: TAB_ANIMATION, opacity: TAB_EXIT_ANIMATION },
} as const;

interface TabTriggerProps {
	value: string;
	icon: React.ReactNode;
	title: string;
	maxTitleLength: number;
	badge?: React.ReactNode;
	onClose: () => void;
}

function buildSortableId(
	kind: typeof TERMINAL_SORTABLE_PREFIX | typeof FILE_SORTABLE_PREFIX,
	index: number,
) {
	return `${kind}:${index}`;
}

function parseSortableId(id: string) {
	const [kind, rawIndex] = id.split(":");
	const index = Number(rawIndex);
	if (
		(kind !== TERMINAL_SORTABLE_PREFIX &&
			kind !== FILE_SORTABLE_PREFIX) ||
		Number.isNaN(index)
	) {
		return null;
	}

	return {
		kind,
		index,
	} as const;
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
			<HStack gap="2">
				{displayTitle}
				{badge}
				<CloseButton
					as="span"
					role="button"
					size="2xs"
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
	motionProps,
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
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		display: "flex",
		flexShrink: 0,
		minWidth: 0,
		opacity: isDragging ? 0.45 : 1,
		zIndex: isDragging ? 1 : 0,
	};

	return (
		<motion.div
			style={{
				display: "flex",
				flexShrink: 0,
				overflow: "hidden",
				transformOrigin: "left center",
			}}
			{...motionProps}
		>
			<Box
				ref={setNodeRef}
				style={style}
				{...attributes}
				{...listeners}
				cursor={isDragging ? "grabbing" : "grab"}
			>
				<TabTrigger {...props} />
			</Box>
		</motion.div>
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
	const closeFileTab = useFileViewerTabsStore((state) => state.closeTab);
	const reorderFileTabs = useFileViewerTabsStore((state) => state.reorderTabs);
	const setFileActive = useFileViewerTabsStore((state) => state.setFileActive);
	const setTerminalActive = useFileViewerTabsStore((state) => state.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;

	const closeTab = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);
	const terminalSortableItems = useMemo(
		() =>
			tabs.map((tab, index) => ({
				...tab,
				sortableId: buildSortableId(TERMINAL_SORTABLE_PREFIX, index),
			})),
		[tabs],
	);
	const fileSortableItems = useMemo(
		() =>
			fileTabs.map((tab, index) => ({
				...tab,
				sortableId: buildSortableId(FILE_SORTABLE_PREFIX, index),
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

		const activeItem = parseSortableId(String(active.id));
		const overItem = parseSortableId(String(over.id));
		if (!activeItem || !overItem) return;

		if (activeItem.kind === overItem.kind) {
			if (activeItem.kind === TERMINAL_SORTABLE_PREFIX) {
				reorderTerminalTabs(profileId, activeItem.index, overItem.index);
			} else {
				reorderFileTabs(profileId, activeItem.index, overItem.index);
			}
			return;
		}

		if (
			activeItem.kind === TERMINAL_SORTABLE_PREFIX &&
			overItem.kind === FILE_SORTABLE_PREFIX &&
			tabs.length > 0
		) {
			reorderTerminalTabs(profileId, activeItem.index, tabs.length - 1);
			return;
		}

		if (
			activeItem.kind === FILE_SORTABLE_PREFIX &&
			overItem.kind === TERMINAL_SORTABLE_PREFIX &&
			fileTabs.length > 0
		) {
			reorderFileTabs(profileId, activeItem.index, 0);
		}
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
								<AnimatePresence initial={false}>
									{terminalSortableItems.map((tab) => (
										<SortableTabItem
											key={tab.sortableId}
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
								</AnimatePresence>
							</SortableContext>

							<SortableContext
								items={fileSortableItems.map((tab) => tab.sortableId)}
								strategy={horizontalListSortingStrategy}
							>
								<AnimatePresence initial={false}>
									{fileSortableItems.map((tab) => (
										<SortableTabItem
											key={tab.sortableId}
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
											onClose={() =>
												closeFileTab(profileId, tab.filePath)
											}
										/>
									))}
								</AnimatePresence>
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
					<FileViewerPane filePath={activeFilePath} />
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
