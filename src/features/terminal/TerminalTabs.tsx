import claudeIconUrl from "@lobehub/icons-static-svg/icons/claude-color.svg";
import clineIconUrl from "@lobehub/icons-static-svg/icons/cline.svg";
import codexIconUrl from "@lobehub/icons-static-svg/icons/codex-color.svg";
import geminiIconUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import kimiIconUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import openClawIconUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import opencodeIconUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
import qoderIconUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg";
import { RiCloseLine } from "@remixicon/react";
import {
	lazy,
	Suspense,
	use,
	useCallback,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { FiTerminal } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import { Spinner } from "@/components/ui/spinner";
import {
	Tabs,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
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
import { AgentStatusDot } from "./AgentStatusDot";
import { useCloseTerminalTab } from "./hooks";
import { restorePendingTerminalTab } from "./restoration";
import { useTerminalStore, type TerminalTab } from "./store";
import TerminalTemplateMenu from "./TerminalTemplateMenu";
import { Terminal } from "./Terminal";

const FileViewerPane = lazy(() => import("@/features/projects/FileViewerPane"));
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
};
const EMPTY_DIRTY_FILE_PATHS: string[] = [];
const TAB_TRIGGER_LAYOUT_CLASS = "max-w-56 flex-none justify-start";
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

function PendingTerminalRestore({
	profileId,
	tab,
}: {
	profileId: string;
	tab: TerminalTab;
}) {
	use(restorePendingTerminalTab(profileId, tab));

	return (
		<div className="flex h-full items-center justify-center">
			<Spinner />
		</div>
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
			draggable={false}
			src={match.iconUrl}
			style={{ width: 14, height: 14, flexShrink: 0 }}
		/>
	);
}

function TabCloseButton({
	title,
	onClose,
}: {
	title: string;
	onClose: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={`Close ${title}`}
			className="grid size-4 shrink-0 place-items-center border-0 bg-transparent p-0"
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				onClose();
			}}
		>
			<RiCloseLine className="size-3" />
		</button>
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
	const setTerminalActive = useFileViewerTabsStore((state) => state.setTerminalActive);

	const fileTabs = fileViewerState.tabs;
	const activeFilePath = fileViewerState.activeFilePath;
	const fileTabActive = fileViewerState.fileTabActive;
	const dirtyFilePathSet = useMemo(
		() => new Set(dirtyFilePaths),
		[dirtyFilePaths],
	);

	const { mutate: closeTerminalTab } = useCloseTerminalTab();
	const [pendingCloseFile, setPendingCloseFile] = useState<{
		filePath: string;
		title: string;
	} | null>(null);

	const activeValue = fileTabActive ? activeFilePath : activeTabId;

	const handleTabChange = useCallback((value: string | null) => {
		if (!value) return;

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

		return (node: HTMLElement | null) => {
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
			activeTerminalTab && !activeTerminalTab.restore
				? createTerminalDropRef(activeTerminalTab)
				: undefined,
		[activeTerminalTab, createTerminalDropRef],
	);

	const terminalDropRefCacheRef = useRef(
		new Map<string, (node: HTMLElement | null) => void>(),
	);
	const terminalDropRefFactoryRef = useRef(createTerminalDropRef);
	if (terminalDropRefFactoryRef.current !== createTerminalDropRef) {
		terminalDropRefFactoryRef.current = createTerminalDropRef;
		terminalDropRefCacheRef.current.clear();
	}
	const terminalTabIds = new Set(
		tabs.filter((tab) => !tab.restore).map((tab) => tab.id),
	);
	for (const tabId of terminalDropRefCacheRef.current.keys()) {
		if (!terminalTabIds.has(tabId)) {
			terminalDropRefCacheRef.current.delete(tabId);
		}
	}
	for (const tab of tabs) {
		if (tab.restore) continue;
		if (!terminalDropRefCacheRef.current.has(tab.id)) {
			terminalDropRefCacheRef.current.set(
				tab.id,
				createTerminalDropRef({ id: tab.id }),
			);
		}
	}
	const terminalDropRefs = terminalDropRefCacheRef.current;

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
		<Tabs
			value={activeValue}
			onValueChange={handleTabChange}
			className="flex h-full w-full min-w-0 flex-col gap-0"
		>
			<div className="flex w-full min-w-0 items-center overflow-x-auto overflow-y-hidden border-b p-0">
				<TabsList variant="line" className="w-max flex-none">
					{tabs.map((tab) => {
						const status = agentStatusByTabId.get(tab.id);
						const completion = agentCompletionByTabId.get(tab.id);

						return (
							<TabsTrigger
								key={tab.id}
								value={tab.id}
								nativeButton={false}
								render={<div />}
								ref={terminalDropRefs.get(tab.id)}
								className={TAB_TRIGGER_LAYOUT_CLASS}
							>
								{getTerminalTabIcon(tab.title)}
								<span className="min-w-0 flex-1 truncate">
									{tab.title}
								</span>
								{status ? <AgentStatusDot status={status} /> : null}
								{!status && completion ? (
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
								) : null}
								<TabCloseButton
									title={tab.title}
									onClose={() =>
										closeTerminalTab({
											profileId,
											sessionId: tab.id,
										})}
								/>
							</TabsTrigger>
						);
					})}

					{fileTabs.map((tab) => (
						<TabsTrigger
							key={tab.filePath}
							value={tab.filePath}
							nativeButton={false}
							render={<div />}
							className={TAB_TRIGGER_LAYOUT_CLASS}
						>
							<FileTreeFileIcon fileName={tab.title} size={14} />
							<span className="min-w-0 flex-1 truncate">
								{tab.title}
							</span>
							{dirtyFilePathSet.has(tab.filePath) ? (
								<span className="size-2 rounded-full bg-muted-foreground" />
							) : null}
							<TabCloseButton
								title={tab.title}
								onClose={() => handleFileTabClose(tab.filePath, tab.title)}
							/>
						</TabsTrigger>
					))}
					{trailingControls}
				</TabsList>
			</div>

			{/* File viewer — static content, safe to conditionally render */}
			{fileTabActive && activeFilePath && (
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

			{/* Terminal area — NEVER unmounted, hidden via CSS when file tab is active */}
			<div
				className="relative min-h-0 flex-1"
				style={{ display: fileTabActive ? "none" : "block" }}
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
						{tab.restore ? (
							isActive &&
							tab.id === activeTabId &&
							!fileTabActive ? (
								<Suspense
									fallback={(
										<div className="flex h-full items-center justify-center">
											<Spinner />
										</div>
									)}
								>
									<PendingTerminalRestore
										profileId={profileId}
										tab={tab}
									/>
								</Suspense>
							) : null
						) : (
							<Terminal
								profileId={profileId}
								sessionId={tab.id}
								isActive={
									isActive &&
									tab.id === activeTabId &&
									!fileTabActive
								}
							/>
						)}
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
		</Tabs>
	);
}
