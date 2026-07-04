import { ChatTextIcon, GitCommitIcon, GitDiffIcon } from "@phosphor-icons/react";
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
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import * as m from "@/paraglide/messages.js";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import { isInteractiveKeyboardTarget } from "@/shared/lib/dom";
import { areSetsEqual } from "@/shared/lib/setUtils";
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
import type { DiffReviewComment } from "../reviewQueue";
import {
	reconcileIncludedFiles,
	resolveWorktreeFilePath,
	toggleIncludedFileName,
} from "../utils";
import { ChangesDiffPane, ChangesSidebar } from "./GitDiffChangesPanel";
import { HistoryDiffPane, HistorySidebar } from "./GitDiffHistoryPanel";
import GitReviewQueueDialog from "./GitReviewQueueDialog";
import { collectOrderedIncludedFileNames } from "./includedFileNames";

const SIDEBAR_TAB_CONTENT_CLASS =
	"absolute inset-0 flex h-full overflow-hidden pt-0 will-change-[opacity,transform] data-active:animate-in data-active:fade-in data-active:zoom-in-95";

interface GitDiffContentProps {
  profileId: string;
  worktreePath: string;
  onClose: () => void;
  state: GitDiffState;
  dispatch: React.Dispatch<GitDiffAction>;
  options: FileDiffOptions<unknown>;
}

export default function GitDiffContent({
  profileId,
  worktreePath,
  onClose,
  state,
  dispatch,
  options
}: GitDiffContentProps) {
  const [includedFileNames, setIncludedFileNames] = useState<Set<string>>(
    () => new Set()
  );
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [reviewComments, setReviewComments] = useState<DiffReviewComment[]>(
    () => []
  );
  const sidebarRef = useRef<HTMLDivElement>(null);
  const previousChangeFileNamesRef = useRef<Set<string>>(new Set());
  const isChanges = state.activeTab === "changes";
  const isHistory = state.activeTab === "history";

  const changesFiles = useGitDiffFiles(profileId);
  const { data: logData } = useGitLog(profileId, isHistory);
  const commits = useMemo(() => logData ?? [], [logData]);
  const changeFileNames = useMemo(
    () => changesFiles.map((file) => file.name),
    [changesFiles]
  );
  const openFileTab = useFileViewerTabsStore((store) => store.openFile);
  const {
    mutateAsync: commitGitChanges,
    isPending: isCommitting
  } = useCommitGitChanges(profileId);
  const { mutateAsync: discardGitFileChanges } =
  useDiscardGitFileChanges(profileId);
  const aheadCount = useGitAheadCount(profileId, isChanges);
  const { mutateAsync: gitPush, isPending: isPushing } = useGitPush(profileId);
  const orderedIncludedFileNames = useMemo(
    () => collectOrderedIncludedFileNames(changesFiles, includedFileNames),
    [changesFiles, includedFileNames]
  );

  const handlePush = useCallback(async () => {
    try {
      await gitPush();
      toast.success(
        m.gitPushSuccessTitle());



    } catch (error) {
      toast.error(
        m.gitPushErrorTitle(), {
          description:
          error instanceof Error ? error.message : String(error) });



    }
  }, [gitPush]);

  const handleAddReviewComment = useCallback((comment: DiffReviewComment) => {
    setReviewComments((comments) => [...comments, comment]);
  }, []);

  const handleUpdateReviewComment = useCallback((id: string, body: string) => {
    setReviewComments((comments) =>
    comments.map((comment) =>
    comment.id === id ? { ...comment, body } : comment
    )
    );
  }, []);

  const handleDeleteReviewComment = useCallback((id: string) => {
    setReviewComments((comments) => {
      const nextComments = comments.filter((comment) => comment.id !== id);
      if (nextComments.length === 0) {
        setReviewQueueOpen(false);
      }
      return nextComments;
    });
  }, []);

  const handleClearReviewComments = useCallback(() => {
    setReviewComments([]);
  }, []);

  const handleTabChange = useCallback((value: string) => {
    startTransition(() => {
      dispatch({
        type: "switchTab",
        tab: value as "changes" | "history"
      });
    });
  }, [dispatch]);
  const handleTabValueChange = useCallback(
    (value: string) => {
      handleTabChange(value);
    },
    [handleTabChange]
  );

  const setFileIncluded = useCallback((fileName: string, included: boolean) => {
    setIncludedFileNames((prev) =>
    toggleIncludedFileName(prev, fileName, included)
    );
  }, []);

  const handleOpenFile = useCallback((file: FileDiffMetadata) => {
    openFileTab(
      profileId,
      resolveWorktreeFilePath(worktreePath, file.name)
    );
    onClose();
  }, [onClose, openFileTab, profileId, worktreePath]);

  const handleDiscardFile = useCallback(async (file: FileDiffMetadata) => {
    const relativePaths = Array.from(
      new Set(
        [file.name, file.prevName].filter((path): path is string =>
        Boolean(path)
        )
      )
    );
    const absolutePaths = relativePaths.map((path) =>
    resolveWorktreeFilePath(worktreePath, path)
    );

    try {
      await discardGitFileChanges({
        paths: relativePaths,
        filePathsToRefresh: absolutePaths
      });
      toast.success(
        m.gitDiscardFileSuccessTitle(), {
          description: m.gitDiscardFileSuccessDescription({
            file: file.name
          }) });



    } catch (error) {
      toast.error(
        m.gitDiscardFileErrorTitle(), {
          description:
          error instanceof Error ? error.message : String(error) });



    }
  }, [discardGitFileChanges, worktreePath]);

  const handleIncludeAll = useCallback(() => {
    setIncludedFileNames(new Set(changeFileNames));
  }, [changeFileNames]);

  const handleIncludeNone = useCallback(() => {
    setIncludedFileNames(new Set());
  }, []);

  const handleCommit = useCallback(async () => {
    try {
      const hash = await commitGitChanges({
        files: orderedIncludedFileNames,
        message: commitMessage.trim(),
        body: commitBody.trim() || undefined
      });
      setCommitMessage("");
      setCommitBody("");
      toast.success(
        m.gitCommitSuccessTitle(), {
          description: m.gitCommitSuccessDescription({
            hash: hash.slice(0, 7)
          }) });



    } catch (error) {
      toast.error(
        m.gitCommitErrorTitle(), {
          description:
          error instanceof Error ? error.message : String(error) });



    }
  }, [commitBody, commitGitChanges, commitMessage, orderedIncludedFileNames]);

  const handleOpenReviewQueue = useCallback(() => {
    setReviewQueueOpen(true);
  }, []);

  const handleCloseReviewQueue = useCallback(() => {
    setReviewQueueOpen(false);
  }, []);

  // Keyboard navigation — dispatch arrow keys to the active list,
  // handle Enter / Escape / Backspace for commit drill-in/back.
  const activeListKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveKeyboardTarget(e.target)) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;

      if (state.activeTab === "changes") {
        dispatch({
          type: "stepIndex",
          target: "file",
          delta,
          count: changesFiles.length
        });
      } else if (state.selectedCommit) {
        dispatch({
          type: "stepIndex",
          target: "commitFile",
          delta,
          count: state.commitFileCount
        });
      } else {
        dispatch({
          type: "stepIndex",
          target: "commit",
          delta,
          count: commits.length
        });
      }
      return;
    }

    if (e.key === " " && state.activeTab === "changes") {
      const activeFile =
      changesFiles.length > 0 &&
      state.selectedFileIndex < changesFiles.length ?
      changesFiles[state.selectedFileIndex] :
      null;

      if (activeFile) {
        e.preventDefault();
        setFileIncluded(
          activeFile.name,
          !includedFileNames.has(activeFile.name)
        );
      }
      return;
    }

    if (
    e.key === "Enter" &&
    state.activeTab === "history" &&
    !state.selectedCommit)
    {
      e.preventDefault();
      if (
      commits.length > 0 &&
      state.selectedCommitIndex < commits.length)
      {
        startTransition(() => {
          dispatch({
            type: "selectCommit",
            commit: commits[state.selectedCommitIndex],
            index: state.selectedCommitIndex
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
  }, [
  changesFiles,
  commits,
  dispatch,
  includedFileNames,
  setFileIncluded,
  state.activeTab,
  state.commitFileCount,
  state.selectedCommit,
  state.selectedCommitIndex,
  state.selectedFileIndex]
  );

  // Cmd+Enter triggers push when push button is visible (no local changes, commits ahead)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      if (
      changesFiles.length === 0 &&
      aheadCount > 0 &&
      !isPushing)
      {
        e.preventDefault();
        handlePush();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [changesFiles.length, aheadCount, isPushing, handlePush]);

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
    const prevFileNames = previousChangeFileNamesRef.current;

    setIncludedFileNames((prevIncluded) => {
      const nextIncluded = reconcileIncludedFiles(
        changeFileNames,
        prevIncluded,
        prevFileNames
      );
      return areSetsEqual(prevIncluded, nextIncluded) ?
      prevIncluded :
      nextIncluded;
    });

    previousChangeFileNamesRef.current = new Set(changeFileNames);
  }, [changeFileNames]);

  useEffect(() => {
    if (
    changesFiles.length > 0 &&
    state.selectedFileIndex >= changesFiles.length)
    {
      startTransition(() => {
        dispatch({
          type: "selectFile",
          index: changesFiles.length - 1
        });
      });
    }
  }, [changesFiles.length, dispatch, state.selectedFileIndex]);

  const ctxValue = useMemo(
    () => ({ state, dispatch, profileId, changesFiles, commits, options }),
    [state, dispatch, profileId, changesFiles, commits, options]
  );

	return (
		<GitDiffContext value={ctxValue}>
			<div className="relative flex min-h-0 flex-1 overflow-hidden">
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<div
						ref={sidebarRef}
						className="flex w-[360px] shrink-0 flex-col overflow-hidden border-r outline-none"
						tabIndex={0}
						onKeyDown={activeListKeyDown}
					>
						<Tabs
							value={state.activeTab}
							onValueChange={handleTabValueChange}
							className="flex min-h-0 flex-1 flex-col gap-0"
						>
							<TabsList className="mx-3 mb-2 mt-2">
								<TabsTrigger value="changes">
									<GitDiffIcon />
									{m.changes()}
								</TabsTrigger>
								<TabsTrigger value="history">
									<GitCommitIcon />
									{m.history()}
								</TabsTrigger>
							</TabsList>

							<div className="relative min-h-0 flex-1 overflow-hidden">
								<TabsContent
									value="changes"
									className={SIDEBAR_TAB_CONTENT_CLASS}
								>
									<AsyncBoundary
										fallback={<LoadingSpinner size="sm" />}
										errorFallback={({ error, onRetry }) => (
											<LoadingError
												error={error}
												onRetry={onRetry}
												size="sm"
											/>
										)}
									>
										<ChangesSidebar
											includedFileNames={includedFileNames}
											commitMessage={commitMessage}
											commitBody={commitBody}
											isCommitting={isCommitting}
											aheadCount={aheadCount}
											isPushing={isPushing}
											onToggleIncluded={setFileIncluded}
											onOpenFile={handleOpenFile}
											onDiscardFile={handleDiscardFile}
											onIncludeAll={handleIncludeAll}
											onIncludeNone={handleIncludeNone}
											onCommitMessageChange={setCommitMessage}
											onCommitBodyChange={setCommitBody}
											onPush={handlePush}
											onCommit={handleCommit}
										/>
									</AsyncBoundary>
								</TabsContent>

								<TabsContent
									value="history"
									className={SIDEBAR_TAB_CONTENT_CLASS}
								>
									<AsyncBoundary
										fallback={<LoadingSpinner size="sm" />}
										errorFallback={({ error, onRetry }) => (
											<LoadingError
												error={error}
												onRetry={onRetry}
												size="sm"
											/>
										)}
									>
										<HistorySidebar />
									</AsyncBoundary>
								</TabsContent>
							</div>
						</Tabs>
					</div>

					<Activity mode={isChanges ? "visible" : "hidden"}>
						<ChangesDiffPane
							visible={isChanges}
							onAddReviewComment={handleAddReviewComment}
						/>
					</Activity>

					<Activity mode={!isChanges ? "visible" : "hidden"}>
						<HistoryDiffPane visible={!isChanges} />
					</Activity>
				</div>

				{reviewComments.length > 0 ? (
					<Button
						className="absolute right-4 bottom-4 z-[3] shadow-xl"
						size="sm"
						onClick={handleOpenReviewQueue}
					>
						<ChatTextIcon />
						<span className="text-sm font-medium">Review Queue</span>
						<span className="min-w-5 rounded-full bg-primary-foreground/20 px-1.5 text-center text-xs font-semibold leading-5">
							{reviewComments.length}
						</span>
					</Button>
				) : null}

				{reviewQueueOpen ? (
					<GitReviewQueueDialog
						isOpen={reviewQueueOpen}
						comments={reviewComments}
						options={options}
						onClose={handleCloseReviewQueue}
						onClear={handleClearReviewComments}
						onDelete={handleDeleteReviewComment}
						onUpdate={handleUpdateReviewComment}
					/>
				) : null}
			</div>
		</GitDiffContext>
	);
}
