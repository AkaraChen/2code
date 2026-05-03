import {
	Box,
	Circle,
	CloseButton,
	Flex,
	HStack,
	Spinner,
	Tabs,
} from "@chakra-ui/react";
import claudeIconUrl from "@lobehub/icons-static-svg/icons/claude-color.svg";
import clineIconUrl from "@lobehub/icons-static-svg/icons/cline.svg";
import codexIconUrl from "@lobehub/icons-static-svg/icons/codex-color.svg";
import geminiIconUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import kimiIconUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import openClawIconUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import qoderIconUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg";
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
import { lazy, Suspense, useMemo } from "react";
import { FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
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
const AGENT_TAB_ICONS: { keyword: string; iconUrl: string }[] = [
	{ keyword: "claude", iconUrl: claudeIconUrl },
	{ keyword: "codex", iconUrl: codexIconUrl },
	{ keyword: "gemini", iconUrl: geminiIconUrl },
	{ keyword: "kimi", iconUrl: kimiIconUrl },
	{ keyword: "cline", iconUrl: clineIconUrl },
	{ keyword: "openclaw", iconUrl: openClawIconUrl },
	{ keyword: "qoder", iconUrl: qoderIconUrl },
];
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

function getTerminalTabIcon(title: string) {
	const lowerTitle = title.toLowerCase();
	const match = AGENT_TAB_ICONS.find(({ keyword }) =>
		lowerTitle.includes(keyword),
	);

	if (!match) return <FiTerminal size={14} />;

	return (
		<img
			alt=""
			aria-hidden="true"
			src={match.iconUrl}
			style={{ width: 14, height: 14, flexShrink: 0 }}
		/>
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
	const dirtyFilePaths = useFileViewerDirtyStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_DIRTY_FILE_PATHS),
	);
	const closeFileTab = useFileViewerTabsStore((state) => state.closeTab);
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
								<AnimatePresence initial={false}>
									{terminalSortableItems.map((tab) => (
										<SortableTabItem
											key={tab.id}
											sortableId={tab.sortableId}
											value={tab.id}
											icon={getTerminalTabIcon(tab.title)}
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
											key={tab.filePath}
											sortableId={tab.sortableId}
											value={tab.filePath}
											icon={
												<FileTreeFileIcon
													fileName={tab.title}
													size={14}
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
					<Suspense
						fallback={(
							<Flex align="center" justify="center" h="32">
								<Spinner size="sm" />
							</Flex>
						)}
					>
						<FileViewerPane filePath={activeFilePath} profileId={profileId} />
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
