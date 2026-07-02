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
	useCallback,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { FiFileText, FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { AgentStatusDot } from "./AgentStatusDot";
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
const REDUCED_TAB_MOTION_PROPS = {};

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
	isActive?: boolean;
	emptyFallback?: ReactNode;
}

export default function TerminalTabs({
	projectId,
	profileId,
	cwd,
	profile,
	isActive = true,
	emptyFallback,
}: TerminalTabsProps) {
	const { tabs, activeTabId } = useTerminalStore(
		useShallow((state) => state.profiles[profileId] ?? EMPTY_TERMINAL_PROFILE),
	);
	const agentStatuses = useTerminalStore((state) => state.agentStatuses);
	const agentCompletions = useTerminalStore((state) => state.agentCompletions);
	const dismissAgentCompletion = useTerminalStore(
		(state) => state.dismissAgentCompletion,
	);
	const agentStatusByTabId = useMemo(
		() => {
			const entries = tabs.flatMap((tab) => {
				const status = agentStatuses[tab.id];
				return status ? [[tab.id, status] as const] : [];
			});
			return new Map(entries);
		},
		[agentStatuses, tabs],
	);
	const agentCompletionByTabId = useMemo(
		() => {
			const entries = tabs.flatMap((tab) => {
				const status = agentCompletions[tab.id];
				return status ? [[tab.id, status] as const] : [];
			});
			return new Map(entries);
		},
		[agentCompletions, tabs],
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

	const { mutate: closeTerminalTab } = useCloseTerminalTab();
	const prefersReducedMotion = useReducedMotion();
	const [pendingCloseFile, setPendingCloseFile] = useState<{
		filePath: string;
		title: string;
	} | null>(null);

	// Unified active tab value: file path when a file tab is active, or session ID.
	const activeValue = fileTabActive ? (activeFilePath ?? "") : (activeTabId ?? "");
	const tabMotionProps = prefersReducedMotion
		? REDUCED_TAB_MOTION_PROPS
		: FULL_TAB_MOTION_PROPS;

	const handleTabChange = useCallback((value: string) => {
		const isFileTab = fileTabs.some((tab) => tab.filePath === value);
		if (isFileTab) {
			setFileActive(profileId, value);
			return;
		}

		const isTerminalTab = tabs.some((tab) => tab.id === value);
		if (!isTerminalTab) return;

		setActiveTab(profileId, value);
		setTerminalActive(profileId);
	}, [
		fileTabs,
		profileId,
		setActiveTab,
		setFileActive,
		setTerminalActive,
		tabs,
	]);

	const handleFileTabClose = useCallback((filePath: string, title: string) => {
		if (dirtyFilePathSet.has(filePath)) {
			setPendingCloseFile({ filePath, title });
			return;
		}

		closeFileTab(profileId, filePath);
	}, [closeFileTab, dirtyFilePathSet, profileId]);

	const handleCancelFileClose = useCallback(() => {
		setPendingCloseFile(null);
	}, []);

	const handleDiscardFileChanges = useCallback(() => {
		if (!pendingCloseFile) return;
		closeFileTab(profileId, pendingCloseFile.filePath);
		setPendingCloseFile(null);
	}, [closeFileTab, pendingCloseFile, profileId]);

	const handleTerminalPathDrop = useCallback((
		detail: FileTreeTerminalDropEventDetail,
		tab: { id: string },
	) => {
		const { payload } = detail;
		if (payload.profileId !== profileId) return;

		const data = formatTerminalPathInput(payload.absolutePaths);
		if (!data) return;

		setActiveTab(profileId, tab.id);
		setTerminalActive(profileId);
		writeToPty({ sessionId: tab.id, data });
	}, [profileId, setActiveTab, setTerminalActive]);

	const createTerminalDropRef = useCallback((tab: { id: string }) => {
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
	}, [handleTerminalPathDrop]);

	const activeTerminalTab =
		tabs.find((tab) => tab.id === activeTabId) ?? null;

	const activeTerminalDropRef = useMemo(
		() =>
			activeTerminalTab
				? createTerminalDropRef(activeTerminalTab)
				: undefined,
		[activeTerminalTab, createTerminalDropRef],
	);

	const tabGroups = useMemo<TabStripGroup[]>(
		() => [
			{
				id: "terminal",
				items: tabs.map((tab) => ({
					key: tab.id,
					value: tab.id,
					icon: getTerminalTabIcon(tab.title),
					title: tab.title,
					maxTitleLength: 10,
					elementRef: createTerminalDropRef(tab),
					isSelected:
						!fileTabActive && !notesActive && tab.id === activeValue,
					badge: (() => {
						const status = agentStatusByTabId.get(tab.id);
						if (status) return <AgentStatusDot status={status} />;
						const completion = agentCompletionByTabId.get(tab.id);
						if (!completion) return undefined;
						return (
							<button
								type="button"
								aria-label="Dismiss completion notification"
								className="grid size-4 shrink-0 place-items-center rounded-sm"
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									dismissAgentCompletion(tab.id);
								}}
							>
								<AgentStatusDot status={completion} />
							</button>
						);
					})(),
					onClose: () =>
						closeTerminalTab({
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
					isSelected:
						fileTabActive &&
						!notesActive &&
						tab.filePath === activeValue,
					badge: dirtyFilePathSet.has(tab.filePath) ? (
						<span className="size-2 rounded-full bg-muted-foreground" />
					) : undefined,
					onClose: () => handleFileTabClose(tab.filePath, tab.title),
				})),
			},
		],
		[
			activeValue,
			closeTerminalTab,
			createTerminalDropRef,
			dirtyFilePathSet,
			fileTabActive,
			fileTabs,
			handleFileTabClose,
			notesActive,
			agentStatusByTabId,
			agentCompletionByTabId,
			dismissAgentCompletion,
			profileId,
			tabs,
		],
	);
	const notesControl = useMemo(() => profile ? (
		<Tooltip>
			<TooltipTrigger
				render={(
					<button
						type="button"
						aria-label={m.notes()}
						aria-pressed={notesActive}
						role="tab"
						aria-selected={notesActive}
						tabIndex={notesActive ? 0 : -1}
						className={[
							"flex shrink-0 items-center justify-center gap-2 self-stretch border-r border-t-2 bg-transparent px-3 select-none transition-colors [-webkit-appearance:none] [-webkit-user-drag:none] [&_*]:[-webkit-user-drag:none]",
							"hover:bg-muted active:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]",
							notesActive
								? "border-t-foreground text-foreground"
								: "border-t-transparent text-muted-foreground hover:text-foreground",
						].join(" ")}
						style={{ height: TAB_STRIP_HEIGHT }}
						onClick={() => setNotesActive(profileId)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							setNotesActive(profileId);
						}}
					/>
				)}
			>
				<FiFileText size={14} />
			</TooltipTrigger>
			<TooltipContent>{m.notes()}</TooltipContent>
		</Tooltip>
	) : null, [notesActive, profile, profileId, setNotesActive]);

	const trailingControls = useMemo(
		() => (
			<TerminalTemplateMenu
				profileId={profileId}
				cwd={cwd}
				projectId={projectId}
			/>
		),
		[cwd, profileId, projectId],
	);

	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			<div className="w-full min-w-0 overflow-x-auto overflow-y-hidden border-b">
				<TabStrip
					leadingControl={notesControl}
					groups={tabGroups}
					motionProps={tabMotionProps}
					onSelect={handleTabChange}
					trailingControls={trailingControls}
				/>
			</div>

			{/* File viewer — static content, safe to conditionally render */}
			{fileTabActive && !notesActive && activeFilePath && (
				<div className="min-h-0 flex-1 overflow-hidden">
					<AsyncBoundary
						fallback={(
							<div className="flex h-32 items-center justify-center">
								<Spinner />
							</div>
						)}
						errorFallback={({ error, onRetry }) => (
							<InlineError error={error} height="32" onRetry={onRetry} />
						)}
					>
						<FileViewerPane
							filePath={activeFilePath}
							profileId={profileId}
							rootPath={profile?.worktree_path ?? ""}
							isActive={isActive}
						/>
					</AsyncBoundary>
				</div>
			)}

			{/* Notes editor — conditionally rendered when notes surface is active */}
			{notesActive && profile && (
				<div className="min-h-0 flex-1 overflow-hidden">
					<AsyncBoundary
						fallback={(
							<div className="flex h-32 items-center justify-center">
								<Spinner />
							</div>
						)}
						errorFallback={({ error, onRetry }) => (
							<InlineError error={error} height="32" onRetry={onRetry} />
						)}
					>
						<ProfileNotesEditor profile={profile} />
					</AsyncBoundary>
				</div>
			)}

			{/* Terminal area — NEVER unmounted, hidden via CSS when file tab is active */}
			<div
				className="relative min-h-0 flex-1"
				style={{ display: fileTabActive || notesActive ? "none" : "block" }}
				ref={activeTerminalDropRef}
			>
				{tabs.map((tab) => (
					<div
						key={tab.id}
						className="absolute inset-0"
						style={{
							visibility: tab.id === activeTabId ? "visible" : "hidden",
							pointerEvents: tab.id === activeTabId ? "auto" : "none",
						}}
						aria-hidden={tab.id !== activeTabId}
					>
						<Terminal
							profileId={profileId}
							sessionId={tab.id}
							isActive={
								isActive &&
								tab.id === activeTabId &&
								!fileTabActive &&
								!notesActive
							}
						/>
					</div>
				))}
				{tabs.length === 0 && emptyFallback}
			</div>

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
		</div>
	);
}
