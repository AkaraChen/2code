import {
	Box,
	Circle,
	Flex,
	Portal,
	Spinner,
	Tooltip,
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
import {
	lazy,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { FiFileText, FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import { writeToPty } from "@/generated";
import { AsyncBoundary, InlineError } from "@/shared/components/Fallbacks";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import {
	FILE_TREE_TERMINAL_DROP_EVENT,
	FILE_TREE_TERMINAL_DROP_TARGET_ATTR,
	type FileTreeTerminalDropEventDetail,
	formatTerminalPathInput,
	hasFileTreeTerminalDropPayload,
	readFileTreeTerminalDropPayload,
} from "@/shared/lib/fileTreeTerminalDrop";
import * as m from "@/paraglide/messages.js";
import { useCloseTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import { TAB_STRIP_HEIGHT, TabStrip, type TabStripGroup } from "./TabStrip";
import TerminalTemplateMenu from "./TerminalTemplateMenu";
import { Terminal } from "./Terminal";

const FileViewerPane = lazy(() => import("@/features/projects/FileViewerPane"));
const ProfileNotesEditor = lazy(() => import("@/features/profiles/ProfileNotesEditor"));
const UnsavedFileCloseDialog = lazy(() => import("@/features/projects/UnsavedFileCloseDialog"));

// Stable fallbacks — module-level constants prevent new object refs each render,
// which would break useShallow's equality check and cause infinite re-renders.
const EMPTY_TERMINAL_PROFILE = {
	tabs: [] as { id: string; title: string }[],
	activeTabId: null as string | null,
};
const EMPTY_FILE_PROFILE = {
	tabs: [] as { filePath: string; title: string }[],
	activeFilePath: null as string | null,
	fileTabActive: false,
	notesActive: false,
};
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
	profile?: import("@/generated").Profile;
	emptyFallback?: ReactNode;
}

export default function TerminalTabs({
	projectId,
	profileId,
	cwd,
	profile,
	emptyFallback,
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
	const setNotesActive = useFileViewerTabsStore((state) => state.setNotesActive);
	const setTerminalActive = useFileViewerTabsStore((state) => state.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;
	const notesActive = fileViewerState.notesActive;
	const dirtyFilePathSet = useMemo(
		() => new Set(dirtyFilePaths),
		[dirtyFilePaths],
	);

	const closeTab = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();
	const [pendingCloseFile, setPendingCloseFile] = useState<{
		filePath: string;
		title: string;
	} | null>(null);

	// Unified active tab value: file path when a file tab is active, or session ID.
	const activeValue = fileTabActive ? (activeFilePath ?? "") : (activeTabId ?? "");
	const tabMotionProps = prefersReducedMotion ? {} : FULL_TAB_MOTION_PROPS;

	function handleTabChange(value: string) {
		const isFileTab = fileTabs.some((tab) => tab.filePath === value);
		if (isFileTab) {
			setFileActive(profileId, value);
			return;
		}

		const isTerminalTab = tabs.some((tab) => tab.id === value);
		if (!isTerminalTab) return;

		setActiveTab(profileId, value);
		setTerminalActive(profileId);
	}

	function handleFileTabClose(filePath: string, title: string) {
		if (dirtyFilePathSet.has(filePath)) {
			setPendingCloseFile({ filePath, title });
			return;
		}

		closeFileTab(profileId, filePath);
	}

	function handleCancelFileClose() {
		setPendingCloseFile(null);
	}

	function handleDiscardFileChanges() {
		if (!pendingCloseFile) return;
		closeFileTab(profileId, pendingCloseFile.filePath);
		setPendingCloseFile(null);
	}

	function handleTerminalPathDrop(
		detail: FileTreeTerminalDropEventDetail,
		tab: { id: string },
	) {
		const { payload } = detail;
		if (payload.profileId !== profileId) return;

		const data = formatTerminalPathInput(payload.absolutePaths);
		if (!data) return;

		setActiveTab(profileId, tab.id);
		setTerminalActive(profileId);
		writeToPty({ sessionId: tab.id, data });
	}

	function createTerminalDropRef(tab: { id: string }) {
		let cleanup: (() => void) | null = null;

		return (node: HTMLDivElement | null) => {
			cleanup?.();
			cleanup = null;
			if (!node) return;

			node.setAttribute(FILE_TREE_TERMINAL_DROP_TARGET_ATTR, "");
			const handleDrop = (event: Event) => {
				const customEvent = event as CustomEvent<FileTreeTerminalDropEventDetail>;
				if (!customEvent.detail?.payload) return;
				event.stopPropagation();
				handleTerminalPathDrop(customEvent.detail, tab);
			};
			const handleDragOver = (event: DragEvent) => {
				if (!hasFileTreeTerminalDropPayload(event.dataTransfer)) return;
				event.preventDefault();
				if (event.dataTransfer) {
					try {
						event.dataTransfer.dropEffect = "copy";
					} catch {
						// WebKit can expose readonly DataTransfer effect fields.
					}
				}
			};
			const handleNativeDrop = (event: DragEvent) => {
				const payload = readFileTreeTerminalDropPayload(event.dataTransfer);
				if (!payload) return;
				event.preventDefault();
				event.stopPropagation();
				handleTerminalPathDrop(
					{
						clientX: event.clientX,
						clientY: event.clientY,
						payload,
					},
					tab,
				);
			};
			node.addEventListener(FILE_TREE_TERMINAL_DROP_EVENT, handleDrop);
			node.addEventListener("dragover", handleDragOver);
			node.addEventListener("drop", handleNativeDrop);
			cleanup = () => {
				node.removeEventListener(FILE_TREE_TERMINAL_DROP_EVENT, handleDrop);
				node.removeEventListener("dragover", handleDragOver);
				node.removeEventListener("drop", handleNativeDrop);
				node.removeAttribute(FILE_TREE_TERMINAL_DROP_TARGET_ATTR);
			};
		};
	}

	const activeTerminalTab =
		tabs.find((tab) => tab.id === activeTabId) ?? null;

	const tabGroups: TabStripGroup[] = [
		{
			id: "terminal",
			items: tabs.map((tab) => ({
				key: tab.id,
				value: tab.id,
				icon: getTerminalTabIcon(tab.title),
				title: tab.title,
				maxTitleLength: 10,
				elementRef: createTerminalDropRef(tab),
				isSelected: !fileTabActive && !notesActive && tab.id === activeValue,
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
				isSelected: fileTabActive && !notesActive && tab.filePath === activeValue,
				badge: dirtyFilePathSet.has(tab.filePath) ? (
					<Circle size="2" bg="fg.muted" />
				) : undefined,
				onClose: () => handleFileTabClose(tab.filePath, tab.title),
			})),
		},
	];
	const notesControl = profile ? (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<Box
					as="div"
					aria-label={m.notes()}
					aria-pressed={notesActive}
					role="tab"
					aria-selected={notesActive}
					tabIndex={notesActive ? 0 : -1}
					flexShrink={0}
					alignSelf="stretch"
					h={TAB_STRIP_HEIGHT}
					display="flex"
					alignItems="center"
					justifyContent="center"
					gap="2"
					px="3"
					borderEndWidth="1px"
					borderEndColor="border"
					borderTopWidth="2px"
					borderTopColor={notesActive ? "fg" : "transparent"}
					color={notesActive ? "fg" : "fg.muted"}
					bg="transparent"
					userSelect="none"
					transition="background-color 120ms ease, color 120ms ease"
					css={{
						WebkitAppearance: "none",
						WebkitUserDrag: "none",
						"&::before": {
							display: "none",
						},
						"& *": {
							WebkitUserDrag: "none",
						},
					}}
					_hover={{ bg: "bg.subtle", color: "fg" }}
					_active={{ bg: "bg.muted", color: "fg" }}
					_focusVisible={{
						outline: "2px solid",
						outlineColor: "var(--app-focus-ring)",
						outlineOffset: "-2px",
					}}
					onClick={() => setNotesActive(profileId)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						setNotesActive(profileId);
					}}
				>
					<FiFileText size={14} />
				</Box>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{m.notes()}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	) : null;

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
					leadingControl={notesControl}
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
			{fileTabActive && !notesActive && activeFilePath && (
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

			{/* Notes editor — conditionally rendered when notes surface is active */}
			{notesActive && profile && (
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
						<ProfileNotesEditor profile={profile} />
					</AsyncBoundary>
				</Box>
			)}

			{/* Terminal area — NEVER unmounted, hidden via CSS when file tab is active */}
			<Box
				flex="1"
				minH="0"
				position="relative"
				display={fileTabActive || notesActive ? "none" : "block"}
				ref={
					activeTerminalTab
						? createTerminalDropRef(activeTerminalTab)
						: undefined
				}
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
							isActive={tab.id === activeTabId && !fileTabActive && !notesActive}
						/>
					</Box>
				))}
				{tabs.length === 0 && emptyFallback}
			</Box>

			<AsyncBoundary
				fallback={null}
				errorFallback={({ error, onRetry }) => (
					<InlineError error={error} height="32" onRetry={onRetry} />
				)}
			>
				<UnsavedFileCloseDialog
					fileName={pendingCloseFile?.title ?? ""}
					isOpen={!!pendingCloseFile}
					onCancel={handleCancelFileClose}
					onDiscard={handleDiscardFileChanges}
				/>
			</AsyncBoundary>
		</Flex>
	);
}
