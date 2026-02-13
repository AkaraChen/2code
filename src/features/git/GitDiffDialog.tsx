import {
	Box,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Icon,
	Portal,
	Tabs,
	Text,
} from "@chakra-ui/react";
import type { FileDiffOptions } from "@pierre/diffs";
import {
	Activity,
	Suspense,
	startTransition,
	use,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import { RiGitBranchLine } from "react-icons/ri";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import ChangesFileList from "./components/ChangesFileList";
import CommitList from "./components/CommitList";
import GitDiffPane from "./components/GitDiffPane";
import HistoryFileList from "./components/HistoryFileList";
import { GitDiffContext, gitDiffReducer, initialState } from "./gitDiffReducer";
import { useCommitDiffFiles, useGitDiffFiles, useGitLog } from "./hooks";

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
						<Dialog.Header py="2" px="4">
							<Dialog.Title fontSize="sm">
								<HStack gap="1.5" alignItems="center">
									<Icon fontSize="md">
										<RiGitBranchLine />
									</Icon>
									<Text>{branchName ?? "main"}</Text>
								</HStack>
							</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>

						<Dialog.Body
							p="0"
							flex="1"
							overflow="hidden"
							display="flex"
						>
							<Suspense fallback={null}>
								<GitDiffContent profileId={profileId} />
							</Suspense>
						</Dialog.Body>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}

// ---------------------------------------------------------------------------
// Content orchestrator
// ---------------------------------------------------------------------------

function GitDiffContent({ profileId }: { profileId: string }) {
	const termThemeId = useTerminalThemeId();
	const [state, dispatch] = useReducer(gitDiffReducer, initialState);

	const sidebarRef = useRef<HTMLDivElement>(null);

	const changesFiles = useGitDiffFiles(profileId);
	const { data: logData } = useGitLog(profileId);
	const commits = useMemo(() => logData ?? [], [logData]);

	const options: FileDiffOptions<unknown> = useMemo(
		() => ({
			theme: shikiThemeMap[termThemeId] ?? "github-dark",
			diffStyle: "unified",
			diffIndicators: "classic",
			disableFileHeader: true,
			overflow: "wrap",
			expandUnchanged: true,
		}),
		[termThemeId],
	);

	const handleTabChange = (value: string) => {
		startTransition(() => {
			dispatch({
				type: "switchTab",
				tab: value as "changes" | "history",
			});
		});
	};

	// Keyboard navigation — dispatch arrow keys to the active list,
	// handle Enter / Escape / Backspace for commit drill-in/back.
	const activeListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
					w="320px"
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
						variant="subtle"
						flex="1"
						minH="0"
						display="flex"
						flexDirection="column"
					>
						<Tabs.List px="3">
							<Tabs.Trigger value="changes">
								{m.changes()}
							</Tabs.Trigger>
							<Tabs.Trigger value="history">
								{m.history()}
							</Tabs.Trigger>
						</Tabs.List>

						{/* Changes sidebar */}
						<Activity mode={isChanges ? "visible" : "hidden"}>
							<Box
								flex={isChanges ? "1" : undefined}
								display={isChanges ? "flex" : "none"}
								flexDirection="column"
								overflow="hidden"
							>
								<Suspense fallback={null}>
									<ChangesSidebar />
								</Suspense>
							</Box>
						</Activity>

						{/* History sidebar */}
						<Activity mode={!isChanges ? "visible" : "hidden"}>
							<Box
								flex={!isChanges ? "1" : undefined}
								display={!isChanges ? "flex" : "none"}
								flexDirection="column"
								overflow="hidden"
							>
								<Suspense fallback={null}>
									<HistorySidebar />
								</Suspense>
							</Box>
						</Activity>
					</Tabs.Root>
				</Flex>

				{/* Pane column */}
				<Activity mode={isChanges ? "visible" : "hidden"}>
					<Suspense fallback={null}>
						<ChangesDiffPane visible={isChanges} />
					</Suspense>
				</Activity>

				<Activity mode={!isChanges ? "visible" : "hidden"}>
					<Suspense fallback={null}>
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

function ChangesSidebar() {
	const { changesFiles, state, dispatch } = use(GitDiffContext)!;

	if (changesFiles.length === 0) {
		return (
			<Flex align="center" justify="center" flex="1" p="8">
				<Box color="fg.muted" fontSize="sm">
					{m.noChangesDetected()}
				</Box>
			</Flex>
		);
	}

	return (
		<Box flex="1" overflowY="auto">
			<ChangesFileList
				files={changesFiles}
				selectedIndex={state.selectedFileIndex}
				onSelect={(i) => dispatch({ type: "selectFile", index: i })}
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
		<Box flex="1" display={visible ? "flex" : "none"}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				emptyMessage={
					changesFiles.length === 0
						? m.noChangesDetected()
						: m.selectFileToView()
				}
			/>
		</Box>
	);
}

// ---------------------------------------------------------------------------
// History tab components
// ---------------------------------------------------------------------------

function HistorySidebar() {
	const { commits, state, dispatch } = use(GitDiffContext)!;

	if (state.selectedCommit) {
		return (
			<Box
				flex="1"
				display="flex"
				flexDirection="column"
				minH="0"
				overflow="hidden"
			>
				<CommitFileSidebar />
			</Box>
		);
	}

	if (commits.length === 0) {
		return (
			<Flex align="center" justify="center" flex="1" p="8">
				<Box color="fg.muted" fontSize="sm">
					{m.noCommitsFound()}
				</Box>
			</Flex>
		);
	}

	return (
		<CommitList
			commits={commits}
			selectedIndex={state.selectedCommitIndex}
			onCommitSelect={(commit, index) =>
				startTransition(() => {
					dispatch({ type: "selectCommit", commit, index });
				})
			}
		/>
	);
}

function CommitFileSidebar() {
	const { profileId, state, dispatch } = use(GitDiffContext)!;
	const commit = state.selectedCommit!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);

	useEffect(() => {
		dispatch({ type: "setCommitFileCount", count: files.length });
	}, [dispatch, files.length]);

	return (
		<HistoryFileList
			commit={commit}
			files={files}
			selectedIndex={state.selectedCommitFileIndex}
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

	if (!state.selectedCommit) {
		return (
			<Box flex="1" display={visible ? "flex" : "none"}>
				<GitDiffPane
					activeFile={null}
					options={options}
					emptyMessage={m.selectFileToView()}
				/>
			</Box>
		);
	}

	return <CommitDiffViewer visible={visible} />;
}

function CommitDiffViewer({ visible }: { visible: boolean }) {
	const { profileId, state, options } = use(GitDiffContext)!;
	const commit = state.selectedCommit!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const activeFile =
		files.length > 0 && state.selectedCommitFileIndex < files.length
			? files[state.selectedCommitFileIndex]
			: null;

	return (
		<Box flex="1" display={visible ? "flex" : "none"}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				emptyMessage={m.selectFileToView()}
			/>
		</Box>
	);
}
