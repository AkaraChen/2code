import {
	Box,
	CloseButton,
	createListCollection,
	Dialog,
	Flex,
	HStack,
	Icon,
	Select,
	Portal,
	Spinner,
	Tabs,
	Text,
} from "@chakra-ui/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	Activity,
	Suspense,
	startTransition,
	use,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { FiGitBranch } from "react-icons/fi";
import type { GitCommit } from "@/generated";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import ChangesFileList from "./components/ChangesFileList";
import CommitComposer from "./components/CommitComposer";
import CommitList from "./components/CommitList";
import GitDiffPane from "./components/GitDiffPane";
import HistoryFileList from "./components/HistoryFileList";
import {
	type GitDiffAction,
	GitDiffContext,
	type GitDiffState,
	type GitDiffViewMode,
	gitDiffReducer,
	initialState,
} from "./gitDiffReducer";
import {
	useCommitDiffFiles,
	useCommitGitChanges,
	useGitAheadCount,
	useGitDiffFiles,
	useGitLog,
	useGitPush,
} from "./hooks";
import { reconcileIncludedFiles } from "./utils";
import { toaster } from "@/shared/providers/Toaster";

const shikiThemeMap: Record<TerminalThemeId, string> = {
	"github-dark": "github-dark",
	"github-light": "github-light",
	dracula: "dracula",
	"ayu-dark": "ayu-dark",
	"ayu-light": "ayu-light",
	"solarized-dark": "solarized-dark",
	"solarized-light": "solarized-light",
	"one-dark": "one-dark-pro",
	"one-light": "one-light",
};

const professionalDiffOptions = {
	diffIndicators: "bars",
	hunkSeparators: "line-info",
	lineDiffType: "word-alt",
	collapsedContextThreshold: 8,
	expansionLineCount: 24,
	overflow: "scroll",
} as const satisfies Pick<
	FileDiffOptions<unknown>,
	| "diffIndicators"
	| "hunkSeparators"
	| "lineDiffType"
	| "collapsedContextThreshold"
	| "expansionLineCount"
	| "overflow"
>;

const SIDEBAR_TAB_CONTENT_PROPS = {
	position: "absolute",
	inset: "0",
	display: "flex",
	h: "full",
	overflow: "hidden",
	pt: "0",
	willChange: "opacity, transform",
	_open: {
		animationName: "fade-in, scale-in",
		animationDuration: "300ms",
		animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
		transformOrigin: "top center",
		pointerEvents: "auto",
	},
	_closed: {
		animationName: "fade-out, scale-out",
		animationDuration: "120ms",
		animationTimingFunction: "ease-in",
		transformOrigin: "top center",
		pointerEvents: "none",
	},
} as const;

const HISTORY_PANEL_FADE_TRANSITION = {
	duration: 0.33,
	ease: [0.22, 1, 0.36, 1],
} as const;

function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" }) {
	return (
		<Flex flex="1" align="center" justify="center">
			<Spinner size={size} color="colorPalette.500" />
		</Flex>
	);
}

function VisibleBox({
	visible,
	children,
}: {
	visible: boolean;
	children: React.ReactNode;
}) {
	return (
		<Box flex="1" display={visible ? "flex" : "none"}>
			{children}
		</Box>
	);
}

function HistorySidebarPanel({
	panelKey,
	children,
}: {
	panelKey: string;
	children: React.ReactNode;
}) {
	const prefersReducedMotion = useReducedMotion() ?? false;

	return (
		<Box position="relative" flex="1" minH="0" overflow="hidden">
			<AnimatePresence initial={false}>
				<motion.div
					key={panelKey}
					initial={prefersReducedMotion ? false : { opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={
						prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }
					}
					transition={
						prefersReducedMotion
							? { duration: 0 }
							: HISTORY_PANEL_FADE_TRANSITION
					}
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						flexDirection: "column",
						minHeight: 0,
						overflow: "hidden",
					}}
				>
					{children}
				</motion.div>
			</AnimatePresence>
		</Box>
	);
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return !!target.closest("input, textarea, button, select, [role='textbox']");
}

function areSetsEqual(left: Set<string>, right: Set<string>) {
	if (left.size !== right.size) {
		return false;
	}

	for (const value of left) {
		if (!right.has(value)) {
			return false;
		}
	}

	return true;
}

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
	branchName?: string;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	profileId,
	branchName,
}: GitDiffDialogProps) {
	const termThemeId = useTerminalThemeId();
	const [state, dispatch] = useReducer(gitDiffReducer, initialState);
	const options: FileDiffOptions<unknown> = useMemo(
		() => ({
			theme: shikiThemeMap[termThemeId] ?? "github-dark",
			diffStyle: state.viewMode,
			disableFileHeader: true,
			...professionalDiffOptions,
		}),
		[state.viewMode, termThemeId],
	);

	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content
						overflow="hidden"
						display="flex"
						flexDirection="column"
					>
						<GitDiffHeader
							branchName={branchName}
							viewMode={state.viewMode}
							dispatch={dispatch}
						/>

						<Dialog.Body
							p="0"
							flex="1"
							overflow="hidden"
							display="flex"
						>
							<Suspense fallback={<LoadingSpinner />}>
								<GitDiffContent
									profileId={profileId}
									state={state}
									dispatch={dispatch}
									options={options}
								/>
							</Suspense>
						</Dialog.Body>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}

function GitDiffHeader({
	branchName,
	viewMode,
	dispatch,
}: {
	branchName?: string;
	viewMode: GitDiffViewMode;
	dispatch: React.Dispatch<GitDiffAction>;
}) {
	const previewModeCollection = createListCollection({
		items: [
			{
				value: "unified",
				label: m.gitDiffPreviewModeUnified(),
			},
			{
				value: "split",
				label: m.gitDiffPreviewModeSplit(),
			},
		],
	});

	return (
		<Dialog.Header py="2" pl="4" pr="16">
			<Flex w="full" align="center" gap="3" minW="0">
				<Dialog.Title fontSize="sm" flex="1" minW="0">
					<HStack gap="1.5" alignItems="center" minW="0">
						<Icon fontSize="md" flexShrink={0}>
							<FiGitBranch />
						</Icon>
						<Text truncate>{branchName ?? "main"}</Text>
					</HStack>
				</Dialog.Title>

				<Flex align="center" gap="2" flexShrink={0}>
					<Text fontSize="xs" color="fg.muted">
						{m.gitDiffPreviewMode()}
					</Text>
					<Select.Root
						collection={previewModeCollection}
						value={[viewMode]}
						onValueChange={(e) => {
							const nextViewMode = e.value[0];
							if (!nextViewMode) {
								return;
							}

							dispatch({
								type: "setViewMode",
								viewMode: nextViewMode as GitDiffViewMode,
							});
						}}
						size="xs"
						width="140px"
						positioning={{ sameWidth: false }}
					>
						<Select.HiddenSelect />
						<Select.Control>
							<Select.Trigger>
								<Select.ValueText />
							</Select.Trigger>
							<Select.IndicatorGroup>
								<Select.Indicator />
							</Select.IndicatorGroup>
						</Select.Control>
						<Portal>
							<Select.Positioner>
								<Select.Content>
									{previewModeCollection.items.map((item) => (
										<Select.Item
											item={item}
											key={item.value}
										>
											{item.label}
											<Select.ItemIndicator />
										</Select.Item>
									))}
								</Select.Content>
							</Select.Positioner>
						</Portal>
					</Select.Root>
				</Flex>

				<Dialog.CloseTrigger asChild>
					<CloseButton size="sm" />
				</Dialog.CloseTrigger>
			</Flex>
		</Dialog.Header>
	);
}

// ---------------------------------------------------------------------------
// Content orchestrator
// ---------------------------------------------------------------------------

function GitDiffContent({
	profileId,
	state,
	dispatch,
	options,
}: {
	profileId: string;
	state: GitDiffState;
	dispatch: React.Dispatch<GitDiffAction>;
	options: FileDiffOptions<unknown>;
}) {
	const [includedFileNames, setIncludedFileNames] = useState<Set<string>>(
		() => new Set(),
	);
	const [commitMessage, setCommitMessage] = useState("");
	const [commitBody, setCommitBody] = useState("");
	const sidebarRef = useRef<HTMLDivElement>(null);
	const previousChangeFileNamesRef = useRef<Set<string>>(new Set());

	const changesFiles = useGitDiffFiles(profileId);
	const { data: logData } = useGitLog(profileId);
	const commits = useMemo(() => logData ?? [], [logData]);
	const commitGitChanges = useCommitGitChanges(profileId);
	const aheadCount = useGitAheadCount(profileId);
	const gitPush = useGitPush(profileId);
	const orderedIncludedFileNames = useMemo(
		() =>
			changesFiles.flatMap((file) =>
				includedFileNames.has(file.name) ? [file.name] : [],
			),
		[changesFiles, includedFileNames],
	);

	const handleTabChange = (value: string) => {
		startTransition(() => {
			dispatch({
				type: "switchTab",
				tab: value as "changes" | "history",
			});
		});
	};

	const setFileIncluded = (fileName: string, included: boolean) => {
		setIncludedFileNames((prev) => {
			const next = new Set(prev);
			if (included) {
				next.add(fileName);
			} else {
				next.delete(fileName);
			}
			return next;
		});
	};

	// Keyboard navigation — dispatch arrow keys to the active list,
	// handle Enter / Escape / Backspace for commit drill-in/back.
	const activeListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (isInteractiveKeyboardTarget(e.target)) {
			return;
		}

		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const delta = e.key === "ArrowDown" ? 1 : -1;

			if (state.activeTab === "changes") {
				dispatch({
					type: "stepIndex",
					target: "file",
					delta,
					count: changesFiles.length,
				});
			} else if (state.selectedCommit) {
				dispatch({
					type: "stepIndex",
					target: "commitFile",
					delta,
					count: state.commitFileCount,
				});
			} else {
				dispatch({
					type: "stepIndex",
					target: "commit",
					delta,
					count: commits.length,
				});
			}
			return;
		}

		if (e.key === " " && state.activeTab === "changes") {
			const activeFile =
				changesFiles.length > 0 &&
				state.selectedFileIndex < changesFiles.length
					? changesFiles[state.selectedFileIndex]
					: null;

			if (activeFile) {
				e.preventDefault();
				setFileIncluded(
					activeFile.name,
					!includedFileNames.has(activeFile.name),
				);
			}
			return;
		}

		if (
			e.key === "Enter" &&
			state.activeTab === "history" &&
			!state.selectedCommit
		) {
			e.preventDefault();
			if (
				commits.length > 0 &&
				state.selectedCommitIndex < commits.length
			) {
				startTransition(() => {
					dispatch({
						type: "selectCommit",
						commit: commits[state.selectedCommitIndex],
						index: state.selectedCommitIndex,
					});
				});
			}
			return;
		}

		if (state.activeTab === "history" && state.selectedCommit) {
			if (e.key === "Backspace") {
				e.preventDefault();
				startTransition(() => {
					dispatch({ type: "commitBack" });
				});
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				startTransition(() => {
					dispatch({ type: "commitBack" });
				});
			}
		}
	};

	// Auto-focus sidebar on tab change (also covers initial dialog open)
	useEffect(() => {
		const timer = setTimeout(() => {
			sidebarRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [state.activeTab]);

	// Re-focus sidebar when returning from commit files to commit list
	useEffect(() => {
		if (!state.selectedCommit) {
			sidebarRef.current?.focus();
		}
	}, [state.selectedCommit]);

	useEffect(() => {
		const nextFileNames = changesFiles.map((file) => file.name);
		const nextIncluded = reconcileIncludedFiles(
			nextFileNames,
			includedFileNames,
			previousChangeFileNamesRef.current,
		);

		if (!areSetsEqual(includedFileNames, nextIncluded)) {
			setIncludedFileNames(nextIncluded);
		}

		previousChangeFileNamesRef.current = new Set(nextFileNames);
	}, [changesFiles, includedFileNames]);

	useEffect(() => {
		if (
			changesFiles.length > 0 &&
			state.selectedFileIndex >= changesFiles.length
		) {
			startTransition(() => {
				dispatch({
					type: "selectFile",
					index: changesFiles.length - 1,
				});
			});
		}
	}, [changesFiles.length, dispatch, state.selectedFileIndex]);

	const isChanges = state.activeTab === "changes";

	const ctxValue = useMemo(
		() => ({ state, dispatch, profileId, changesFiles, commits, options }),
		[state, dispatch, profileId, changesFiles, commits, options],
	);

	return (
		<GitDiffContext value={ctxValue}>
			<Flex flex="1" overflow="hidden">
				{/* Sidebar column */}
				<Flex
					ref={sidebarRef}
					direction="column"
					w="360px"
					flexShrink={0}
					overflow="hidden"
					tabIndex={0}
					onKeyDown={activeListKeyDown}
					outline="none"
				>
					<Tabs.Root
						value={state.activeTab}
						onValueChange={(e) => handleTabChange(e.value)}
						size="sm"
						variant="line"
						flex="1"
						minH="0"
						display="flex"
						flexDirection="column"
					>
						<Tabs.List mx="3" mt="2">
							<Tabs.Trigger value="changes">
								{m.changes()}
							</Tabs.Trigger>
							<Tabs.Trigger value="history">
								{m.history()}
							</Tabs.Trigger>
						</Tabs.List>

						<Box position="relative" flex="1" minH="0" overflow="hidden">
							<Tabs.Content
								value="changes"
								{...SIDEBAR_TAB_CONTENT_PROPS}
							>
								<Suspense fallback={<LoadingSpinner size="sm" />}>
									<ChangesSidebar
										includedFileNames={includedFileNames}
										commitMessage={commitMessage}
										commitBody={commitBody}
										isCommitting={commitGitChanges.isPending}
										aheadCount={aheadCount}
										isPushing={gitPush.isPending}
										onToggleIncluded={setFileIncluded}
										onIncludeAll={() =>
											setIncludedFileNames(
												new Set(
													changesFiles.map(
														(file) => file.name,
													),
												),
											)
										}
										onIncludeNone={() =>
											setIncludedFileNames(new Set())
										}
										onCommitMessageChange={
											setCommitMessage
										}
										onCommitBodyChange={setCommitBody}
										onPush={async () => {
											try {
												await gitPush.mutateAsync();
												toaster.create({
													title: m.gitPushSuccessTitle(),
													type: "success",
													closable: true,
												});
											} catch (error) {
												toaster.create({
													title: m.gitPushErrorTitle(),
													description:
														error instanceof Error
															? error.message
															: String(error),
													type: "error",
													closable: true,
												});
											}
										}}
										onCommit={async () => {
											try {
												const hash =
													await commitGitChanges.mutateAsync(
														{
															files: orderedIncludedFileNames,
															message:
																commitMessage.trim(),
															body:
																commitBody.trim() ||
																undefined,
														},
													);
												setCommitMessage("");
												setCommitBody("");
												toaster.create({
													title: m.gitCommitSuccessTitle(),
													description:
														m.gitCommitSuccessDescription(
															{
																hash: hash.slice(
																	0,
																	7,
																),
															},
														),
													type: "success",
													closable: true,
												});
											} catch (error) {
												toaster.create({
													title: m.gitCommitErrorTitle(),
													description:
														error instanceof Error
															? error.message
															: String(error),
													type: "error",
													closable: true,
												});
											}
										}}
									/>
								</Suspense>
							</Tabs.Content>

							<Tabs.Content
								value="history"
								{...SIDEBAR_TAB_CONTENT_PROPS}
							>
								<Suspense fallback={<LoadingSpinner size="sm" />}>
									<HistorySidebar />
								</Suspense>
							</Tabs.Content>
						</Box>
					</Tabs.Root>
				</Flex>

				{/* Pane column */}
				<Activity mode={isChanges ? "visible" : "hidden"}>
					<Suspense fallback={<LoadingSpinner />}>
						<ChangesDiffPane visible={isChanges} />
					</Suspense>
				</Activity>

				<Activity mode={!isChanges ? "visible" : "hidden"}>
					<Suspense fallback={<LoadingSpinner />}>
						<HistoryDiffPane visible={!isChanges} />
					</Suspense>
				</Activity>
			</Flex>
		</GitDiffContext>
	);
}

// ---------------------------------------------------------------------------
// Changes tab components
// ---------------------------------------------------------------------------

interface ChangesSidebarProps {
	includedFileNames: Set<string>;
	commitMessage: string;
	commitBody: string;
	isCommitting: boolean;
	aheadCount: number;
	isPushing: boolean;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onIncludeAll: () => void;
	onIncludeNone: () => void;
	onCommitMessageChange: (value: string) => void;
	onCommitBodyChange: (value: string) => void;
	onCommit: () => void;
	onPush: () => void;
}

function ChangesSidebar({
	includedFileNames,
	commitMessage,
	commitBody,
	isCommitting,
	aheadCount,
	isPushing,
	onToggleIncluded,
	onIncludeAll,
	onIncludeNone,
	onCommitMessageChange,
	onCommitBodyChange,
	onCommit,
	onPush,
}: ChangesSidebarProps) {
	const { changesFiles, state, dispatch } = use(GitDiffContext)!;

	return (
		<Box
			flex="1"
			display="flex"
			flexDirection="column"
			minH="0"
			bg="bg.subtle"
		>
			<Box flex="1" overflowY="auto" minH="0">
				{changesFiles.length === 0 ? (
					<Flex align="center" justify="center" h="full" p="8">
						<Box color="fg.muted" fontSize="sm">
							{m.noChangesDetected()}
						</Box>
					</Flex>
				) : (
					<ChangesFileList
						files={changesFiles}
						selectedIndex={state.selectedFileIndex}
						includedFileNames={includedFileNames}
						onSelect={(i) =>
							dispatch({ type: "selectFile", index: i })
						}
						onToggleIncluded={onToggleIncluded}
						onIncludeAll={onIncludeAll}
						onIncludeNone={onIncludeNone}
					/>
				)}
			</Box>

			<CommitComposer
				commitMessage={commitMessage}
				commitBody={commitBody}
				includedCount={includedFileNames.size}
				totalCount={changesFiles.length}
				isPending={isCommitting}
				aheadCount={aheadCount}
				isPushing={isPushing}
				onMessageChange={onCommitMessageChange}
				onBodyChange={onCommitBodyChange}
				onSubmit={onCommit}
				onPush={onPush}
			/>
		</Box>
	);
}

function ChangesDiffPane({ visible }: { visible: boolean }) {
	const { changesFiles, state, options } = use(GitDiffContext)!;
	const activeFile =
		changesFiles.length > 0 && state.selectedFileIndex < changesFiles.length
			? changesFiles[state.selectedFileIndex]
			: null;

	return (
		<VisibleBox visible={visible}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				contextKey="working-tree"
				emptyMessage={
					changesFiles.length === 0
						? m.noChangesDetected()
						: m.selectFileToView()
				}
			/>
		</VisibleBox>
	);
}

// ---------------------------------------------------------------------------
// History tab components
// ---------------------------------------------------------------------------

function HistorySidebar() {
	const { commits, state, dispatch } = use(GitDiffContext)!;
	const selectedCommit = state.selectedCommit;

	if (selectedCommit) {
		return (
			<HistorySidebarPanel panelKey={`commit:${selectedCommit.full_hash}`}>
				<Suspense fallback={<LoadingSpinner size="sm" />}>
					<CommitFileSidebar
						commit={selectedCommit}
						selectedIndex={state.selectedCommitFileIndex}
					/>
				</Suspense>
			</HistorySidebarPanel>
		);
	}

	if (commits.length === 0) {
		return (
			<HistorySidebarPanel panelKey="empty">
				<Flex align="center" justify="center" flex="1" p="8">
					<Box color="fg.muted" fontSize="sm">
						{m.noCommitsFound()}
					</Box>
				</Flex>
			</HistorySidebarPanel>
		);
	}

	return (
		<HistorySidebarPanel panelKey="list">
			<CommitList
				commits={commits}
				selectedIndex={state.selectedCommitIndex}
				onCommitSelect={(commit, index) =>
					startTransition(() => {
						dispatch({ type: "selectCommit", commit, index });
					})
				}
			/>
		</HistorySidebarPanel>
	);
}

function CommitFileSidebar({
	commit,
	selectedIndex,
}: {
	commit: GitCommit;
	selectedIndex: number;
}) {
	const { profileId, dispatch } = use(GitDiffContext)!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);

	useEffect(() => {
		dispatch({ type: "setCommitFileCount", count: files.length });
	}, [dispatch, files.length]);

	return (
		<HistoryFileList
			commit={commit}
			files={files}
			selectedIndex={selectedIndex}
			onFileSelect={(i) =>
				dispatch({ type: "selectCommitFile", index: i })
			}
			onBack={() =>
				startTransition(() => {
					dispatch({ type: "commitBack" });
				})
			}
		/>
	);
}

function HistoryDiffPane({ visible }: { visible: boolean }) {
	const { state, options } = use(GitDiffContext)!;
	const selectedCommit = state.selectedCommit;

	if (!selectedCommit) {
		return (
			<VisibleBox visible={visible}>
				<HistorySidebarPanel panelKey="history-empty">
					<GitDiffPane
						activeFile={null}
						options={options}
						contextKey="history"
						emptyMessage={m.selectFileToView()}
					/>
				</HistorySidebarPanel>
			</VisibleBox>
		);
	}

	return (
		<VisibleBox visible={visible}>
			<HistorySidebarPanel panelKey={`history:${selectedCommit.full_hash}`}>
				<Suspense fallback={<LoadingSpinner />}>
					<CommitDiffViewer
						commit={selectedCommit}
						selectedIndex={state.selectedCommitFileIndex}
					/>
				</Suspense>
			</HistorySidebarPanel>
		</VisibleBox>
	);
}

function CommitDiffViewer({
	commit,
	selectedIndex,
}: {
	commit: GitCommit;
	selectedIndex: number;
}) {
	const { profileId, options } = use(GitDiffContext)!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const activeFile =
		files.length > 0 && selectedIndex < files.length
			? files[selectedIndex]
			: null;

	return (
		<GitDiffPane
			activeFile={activeFile}
			options={options}
			contextKey={commit.full_hash}
			emptyMessage={m.selectFileToView()}
		/>
	);
}
