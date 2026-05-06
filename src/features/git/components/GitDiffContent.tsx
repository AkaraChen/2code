import { Box, Flex, Tabs } from "@chakra-ui/react";
import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import {
	Activity,
	startTransition,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import * as m from "@/paraglide/messages.js";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import { isInteractiveKeyboardTarget } from "@/shared/lib/dom";
import { areSetsEqual } from "@/shared/lib/setUtils";
import { toaster } from "@/shared/providers/Toaster";
import {
	type GitDiffAction,
	GitDiffContext,
	type GitDiffState,
} from "../gitDiffReducer";
import {
	useCommitGitChanges,
	useDiscardGitFileChanges,
	useGitAheadCount,
	useGitDiffFiles,
	useGitLog,
	useGitPush,
} from "../hooks";
import { reconcileIncludedFiles } from "../utils";
import { ChangesDiffPane, ChangesSidebar } from "./GitDiffChangesPanel";
import { HistoryDiffPane, HistorySidebar } from "./GitDiffHistoryPanel";

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

interface GitDiffContentProps {
	profileId: string;
	worktreePath: string;
	onClose: () => void;
	state: GitDiffState;
	dispatch: React.Dispatch<GitDiffAction>;
	options: FileDiffOptions<unknown>;
}

function resolveWorktreeFilePath(
	worktreePath: string,
	relativePath: string,
) {
	const separator = worktreePath.includes("\\") ? "\\" : "/";
	const normalizedRelativePath =
		separator === "\\"
			? relativePath.replace(/\//g, "\\")
			: relativePath.replace(/\\/g, "/");

	return worktreePath.endsWith("/") || worktreePath.endsWith("\\")
		? `${worktreePath}${normalizedRelativePath}`
		: `${worktreePath}${separator}${normalizedRelativePath}`;
}

export default function GitDiffContent({
	profileId,
	worktreePath,
	onClose,
	state,
	dispatch,
	options,
}: GitDiffContentProps) {
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
	const openFileTab = useFileViewerTabsStore((store) => store.openFile);
	const commitGitChanges = useCommitGitChanges(profileId);
	const discardGitFileChanges = useDiscardGitFileChanges(profileId);
	const aheadCount = useGitAheadCount(profileId);
	const gitPush = useGitPush(profileId);
	const orderedIncludedFileNames = useMemo(
		() =>
			changesFiles.flatMap((file) =>
				includedFileNames.has(file.name) ? [file.name] : [],
			),
		[changesFiles, includedFileNames],
	);

	const handlePush = useCallback(async () => {
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
				description: error instanceof Error ? error.message : String(error),
				type: "error",
				closable: true,
			});
		}
	}, [gitPush]);

	const handleTabChange = (value: string) => {
		startTransition(() => {
			dispatch({ type: "switchTab", tab: value as "changes" | "history" });
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

	const handleOpenFile = (file: FileDiffMetadata) => {
		openFileTab(
			profileId,
			resolveWorktreeFilePath(worktreePath, file.name),
		);
		onClose();
	};

	const handleDiscardFile = async (file: FileDiffMetadata) => {
		const relativePaths = Array.from(
			new Set(
				[file.name, file.prevName].filter(
					(path): path is string => Boolean(path),
				),
			),
		);
		const absolutePaths = relativePaths.map((path) =>
			resolveWorktreeFilePath(worktreePath, path),
		);

		try {
			await discardGitFileChanges.mutateAsync({
				paths: relativePaths,
				filePathsToRefresh: absolutePaths,
			});
			toaster.create({
				title: m.gitDiscardFileSuccessTitle(),
				description: m.gitDiscardFileSuccessDescription({
					file: file.name,
				}),
				type: "success",
				closable: true,
			});
		} catch (error) {
			toaster.create({
				title: m.gitDiscardFileErrorTitle(),
				description:
					error instanceof Error ? error.message : String(error),
				type: "error",
				closable: true,
			});
		}
	};

	// Keyboard navigation — dispatch arrow keys to the active list,
	// handle Enter / Escape / Backspace for commit drill-in/back.
	const activeListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (isInteractiveKeyboardTarget(e.target)) return;

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
				changesFiles.length > 0 && state.selectedFileIndex < changesFiles.length
					? changesFiles[state.selectedFileIndex]
					: null;

			if (activeFile) {
				e.preventDefault();
				setFileIncluded(activeFile.name, !includedFileNames.has(activeFile.name));
			}
			return;
		}

		if (
			e.key === "Enter" &&
			state.activeTab === "history" &&
			!state.selectedCommit
		) {
			e.preventDefault();
			if (commits.length > 0 && state.selectedCommitIndex < commits.length) {
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

	// Cmd+Enter triggers push when push button is visible (no local changes, commits ahead)
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
			if (changesFiles.length === 0 && aheadCount > 0 && !gitPush.isPending) {
				e.preventDefault();
				handlePush();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [changesFiles.length, aheadCount, gitPush.isPending, handlePush]);

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
				dispatch({ type: "selectFile", index: changesFiles.length - 1 });
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
							<Tabs.Trigger value="changes">{m.changes()}</Tabs.Trigger>
							<Tabs.Trigger value="history">{m.history()}</Tabs.Trigger>
						</Tabs.List>

						<Box position="relative" flex="1" minH="0" overflow="hidden">
							<Tabs.Content value="changes" {...SIDEBAR_TAB_CONTENT_PROPS}>
								<AsyncBoundary
									fallback={<LoadingSpinner size="sm" />}
									errorFallback={({ error, onRetry }) => (
										<LoadingError error={error} onRetry={onRetry} size="sm" />
									)}
								>
									<ChangesSidebar
										includedFileNames={includedFileNames}
										commitMessage={commitMessage}
										commitBody={commitBody}
										isCommitting={commitGitChanges.isPending}
										aheadCount={aheadCount}
										isPushing={gitPush.isPending}
										onToggleIncluded={setFileIncluded}
										onOpenFile={handleOpenFile}
										onDiscardFile={handleDiscardFile}
										onIncludeAll={() =>
											setIncludedFileNames(
												new Set(changesFiles.map((file) => file.name)),
											)
										}
										onIncludeNone={() => setIncludedFileNames(new Set())}
										onCommitMessageChange={setCommitMessage}
										onCommitBodyChange={setCommitBody}
										onPush={handlePush}
										onCommit={async () => {
											try {
												const hash =
													await commitGitChanges.mutateAsync({
														files: orderedIncludedFileNames,
														message: commitMessage.trim(),
														body: commitBody.trim() || undefined,
													});
												setCommitMessage("");
												setCommitBody("");
												toaster.create({
													title: m.gitCommitSuccessTitle(),
													description: m.gitCommitSuccessDescription({
														hash: hash.slice(0, 7),
													}),
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
								</AsyncBoundary>
							</Tabs.Content>

							<Tabs.Content value="history" {...SIDEBAR_TAB_CONTENT_PROPS}>
								<AsyncBoundary
									fallback={<LoadingSpinner size="sm" />}
									errorFallback={({ error, onRetry }) => (
										<LoadingError error={error} onRetry={onRetry} size="sm" />
									)}
								>
									<HistorySidebar />
								</AsyncBoundary>
							</Tabs.Content>
						</Box>
					</Tabs.Root>
				</Flex>

				{/* Pane column — Activity preserves mounted diff state while hidden */}
				<Activity mode={isChanges ? "visible" : "hidden"}>
					<ChangesDiffPane visible={isChanges} />
				</Activity>

				<Activity mode={!isChanges ? "visible" : "hidden"}>
					<HistoryDiffPane visible={!isChanges} />
				</Activity>
			</Flex>
		</GitDiffContext>
	);
}
