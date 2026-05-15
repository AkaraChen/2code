import {
	Box,
	Circle,
	Flex,
	Spinner,
} from "@chakra-ui/react";
import claudeIconUrl from "@lobehub/icons-static-svg/icons/claude-color.svg";
import clineIconUrl from "@lobehub/icons-static-svg/icons/cline.svg";
import codexIconUrl from "@lobehub/icons-static-svg/icons/codex-color.svg";
import geminiIconUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import kimiIconUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import openClawIconUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import opencodeIconUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
import qoderIconUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg";
import { useReducedMotion } from "motion/react";
import { lazy, useMemo } from "react";
import { FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import { AsyncBoundary, InlineError } from "@/shared/components/Fallbacks";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import { useCloseTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import { TabStrip, type TabStripGroup } from "./TabStrip";
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
const AGENT_TAB_ICONS: { keyword: string; iconUrl: string }[] = [
	{ keyword: "claude", iconUrl: claudeIconUrl },
	{ keyword: "codex", iconUrl: codexIconUrl },
	{ keyword: "gemini", iconUrl: geminiIconUrl },
	{ keyword: "kimi", iconUrl: kimiIconUrl },
	{ keyword: "cline", iconUrl: clineIconUrl },
	{ keyword: "openclaw", iconUrl: openClawIconUrl },
	{ keyword: "opencode", iconUrl: opencodeIconUrl },
	{ keyword: "qoder", iconUrl: qoderIconUrl },
];
const FULL_TAB_MOTION_PROPS = {
	initial: { opacity: 0, scale: 0.92, y: 6 },
	animate: { opacity: 1, scale: 1, y: 0 },
	exit: { opacity: 0, scale: 0.88, y: -6, width: 0 },
	transition: { default: TAB_ANIMATION, opacity: TAB_EXIT_ANIMATION },
} as const;

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
			draggable={false}
			src={match.iconUrl}
			style={{ width: 14, height: 14, flexShrink: 0 }}
		/>
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
	const setActiveTab = useTerminalStore((state) => state.setActiveTab);

	const fileViewerState = useFileViewerTabsStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_FILE_PROFILE),
	);
	const dirtyFilePaths = useFileViewerDirtyStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_DIRTY_FILE_PATHS),
	);
	const closeFileTab = useFileViewerTabsStore((state) => state.closeTab);
	const setFileActive = useFileViewerTabsStore((state) => state.setFileActive);
	const setTerminalActive = useFileViewerTabsStore((state) => state.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;
	const dirtyFilePathSet = useMemo(
		() => new Set(dirtyFilePaths),
		[dirtyFilePaths],
	);
	const terminalTabIdSet = useMemo(
		() => new Set(tabs.map((tab) => tab.id)),
		[tabs],
	);
	const fileTabPathSet = useMemo(
		() => new Set(fileTabs.map((tab) => tab.filePath)),
		[fileTabs],
	);

	const closeTab = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();

	// Unified active tab value: file path when a file tab is active, session ID otherwise
	const activeValue = fileTabActive
		? (activeFilePath ?? "")
		: (activeTabId ?? "");
	const tabMotionProps = prefersReducedMotion ? {} : FULL_TAB_MOTION_PROPS;

	function handleTabChange(value: string) {
		if (fileTabPathSet.has(value)) {
			setFileActive(profileId, value);
			return;
		}

		if (!terminalTabIdSet.has(value)) return;

		setActiveTab(profileId, value);
		setTerminalActive(profileId);
	}

	if (tabs.length === 0 && fileTabs.length === 0) return null;

	const tabGroups: TabStripGroup[] = [
		{
			id: "terminal",
			items: tabs.map((tab) => ({
				key: tab.id,
				value: tab.id,
				icon: getTerminalTabIcon(tab.title),
				title: tab.title,
				maxTitleLength: 10,
				isSelected: !fileTabActive && tab.id === activeValue,
				badge:
					notifiedTabSet.has(tab.id) && tab.id !== activeTabId ? (
						<Circle size="2" bg="green.500" />
					) : undefined,
				onClose: () =>
					closeTab.mutate({
						profileId,
						sessionId: tab.id,
					}),
			})),
		},
		{
			id: "file",
			items: fileTabs.map((tab) => ({
				key: tab.filePath,
				value: tab.filePath,
				icon: (
					<FileTreeFileIcon
						fileName={tab.title}
						size={14}
					/>
				),
				title: tab.title,
				maxTitleLength: 14,
				isSelected: fileTabActive && tab.filePath === activeValue,
				badge: dirtyFilePathSet.has(tab.filePath) ? (
					<Circle size="2" bg="fg.muted" />
				) : undefined,
				onClose: () => closeFileTab(profileId, tab.filePath),
			})),
		},
	];

	return (
		<Flex direction="column" h="full" w="full" minW="0">
			<Box
				overflowX="auto"
				overflowY="hidden"
				w="full"
				minW="0"
				borderBottomWidth="1px"
				borderColor="border"
			>
				<TabStrip
					groups={tabGroups}
					motionProps={tabMotionProps}
					onSelect={handleTabChange}
					trailingControls={(
						<TerminalTemplateMenu
							profileId={profileId}
							cwd={cwd}
							projectId={projectId}
						/>
					)}
				/>
			</Box>

			{/* File viewer — static content, safe to conditionally render */}
			{fileTabActive && activeFilePath && (
				<Box flex="1" minH="0" overflow="hidden">
					<AsyncBoundary
						fallback={(
							<Flex align="center" justify="center" h="32">
								<Spinner size="sm" />
							</Flex>
						)}
						errorFallback={({ error, onRetry }) => (
							<InlineError error={error} height="32" onRetry={onRetry} />
						)}
					>
						<FileViewerPane filePath={activeFilePath} profileId={profileId} />
					</AsyncBoundary>
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
