import {
	Box,
	Circle,
	CloseButton,
	Flex,
	HStack,
	Tabs,
} from "@chakra-ui/react";
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
const FULL_TAB_MOTION_PROPS = {
	layout: "position" as const,
	initial: { opacity: 0, scale: 0.92, y: 6 },
	animate: { opacity: 1, scale: 1, y: 0 },
	exit: { opacity: 0, scale: 0.88, y: -6, width: 0 },
	transition: { layout: TAB_ANIMATION, default: TAB_ANIMATION, opacity: TAB_EXIT_ANIMATION },
} as const;

interface TabItemProps {
	value: string;
	icon: React.ReactNode;
	title: string;
	maxTitleLength: number;
	badge?: React.ReactNode;
	motionProps: Record<string, unknown>;
	onClose: () => void;
}

function TabItem({ value, icon, title, maxTitleLength, badge, motionProps, onClose }: TabItemProps) {
	const displayTitle = title.length > maxTitleLength
		? `${title.slice(0, maxTitleLength)}...`
		: title;
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
			<Tabs.Trigger value={value} flexShrink={0} minW={TAB_MIN_WIDTH}>
				{icon}
				<HStack gap="2">
					{displayTitle}
					{badge}
					<CloseButton
						as="span"
						role="button"
						size="2xs"
						onClick={(e) => {
							e.stopPropagation();
							onClose();
						}}
					/>
				</HStack>
			</Tabs.Trigger>
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
		useShallow((s) => s.profiles[profileId] ?? EMPTY_TERMINAL_PROFILE),
	);
	// Scope to this profile's tabs only — avoids re-rendering on unrelated PTY notifications
	const notifiedTabIds = useTerminalStore(
		useShallow((s) => {
			const profile = s.profiles[profileId];
			if (!profile) return [] as string[];
			return profile.tabs
				.filter((t) => s.notifiedTabs.has(t.id))
				.map((t) => t.id);
		}),
	);
	const notifiedTabSet = useMemo(
		() => new Set(notifiedTabIds),
		[notifiedTabIds],
	);
	const setActiveTab = useTerminalStore((s) => s.setActiveTab);

	const fileViewerState = useFileViewerTabsStore(
		useShallow((s) => s.profiles[profileId] ?? EMPTY_FILE_PROFILE),
	);
	const closeFileTab = useFileViewerTabsStore((s) => s.closeTab);
	const setFileActive = useFileViewerTabsStore((s) => s.setFileActive);
	const setTerminalActive = useFileViewerTabsStore((s) => s.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;

	const closeTab = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();

	// Unified active tab value: file path when a file tab is active, session ID otherwise
	const activeValue = fileTabActive
		? (activeFilePath ?? "")
		: (activeTabId ?? "");
	const tabMotionProps = prefersReducedMotion ? {} : FULL_TAB_MOTION_PROPS;

	function handleTabChange(value: string) {
		const isFileTab = fileTabs.some((t) => t.filePath === value);
		if (isFileTab) {
			setFileActive(profileId, value);
		} else {
			setActiveTab(profileId, value);
			setTerminalActive(profileId);
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
				onValueChange={(e) => handleTabChange(e.value)}
			>
				<Box overflowX="auto" overflowY="hidden" w="full" minW="0">
					<Tabs.List w="full" minW="max-content">
						<AnimatePresence initial={false}>
							{tabs.map((tab) => (
								<TabItem
									key={`terminal:${tab.id}`}
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
										closeTab.mutate({ profileId, sessionId: tab.id })
									}
								/>
							))}

							{fileTabs.map((tab) => (
								<TabItem
									key={`file:${tab.filePath}`}
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
									onClose={() => closeFileTab(profileId, tab.filePath)}
								/>
							))}
						</AnimatePresence>

						<TerminalTemplateMenu
							profileId={profileId}
							cwd={cwd}
							projectId={projectId}
						/>
					</Tabs.List>
				</Box>
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
