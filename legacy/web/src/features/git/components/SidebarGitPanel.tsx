import type { FileDiffMetadata } from "@pierre/diffs";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useGitBranch } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { areSetsEqual } from "@/shared/lib/setUtils";
import GitDiffDialog from "../GitDiffDialog";
import { gitDiffReducer, initialState } from "../gitDiffReducer";
import {
	useCommitGitChanges,
	useDiscardGitFileChanges,
	useGitAheadCount,
	useGitDiffFiles,
	useGitPush,
} from "../hooks";
import {
	reconcileIncludedFiles,
	resolveWorktreeFilePath,
	toggleIncludedFileName,
} from "../utils";
import ChangesFileList from "./ChangesFileList";
import CommitComposer from "./CommitComposer";
import { collectOrderedIncludedFileNames } from "./includedFileNames";

interface SidebarGitPanelProps {
	profileId: string;
	worktreePath: string;
}

// Simple sidebar variant of the git dialog's changes tab: pick files, commit.
// Staging happens implicitly in the backend (`git commit --only <files>`).
export default function SidebarGitPanel({
	profileId,
	worktreePath,
}: SidebarGitPanelProps) {
	const [includedFileNames, setIncludedFileNames] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [commitMessage, setCommitMessage] = useState("");
	const [commitBody, setCommitBody] = useState("");
	const [diffDialogOpen, setDiffDialogOpen] = useState(false);
	const [diffDialogState, dispatchDiffDialog] = useReducer(
		gitDiffReducer,
		initialState,
	);
	const { data: branchName } = useGitBranch(worktreePath, diffDialogOpen);
	const previousChangeFileNamesRef = useRef<Set<string>>(new Set());

	const changesFiles = useGitDiffFiles(profileId);
	const changeFileNames = useMemo(
		() => changesFiles.map((file) => file.name),
		[changesFiles],
	);
	const { mutateAsync: commitGitChanges, isPending: isCommitting } =
		useCommitGitChanges(profileId);
	const { mutateAsync: discardGitFileChanges } =
		useDiscardGitFileChanges(profileId);
	const aheadCount = useGitAheadCount(profileId);
	const { mutateAsync: gitPush, isPending: isPushing } = useGitPush(profileId);
	const orderedIncludedFileNames = useMemo(
		() => collectOrderedIncludedFileNames(changesFiles, includedFileNames),
		[changesFiles, includedFileNames],
	);

	// Newly changed files start included; explicit user picks survive refreshes.
	useEffect(() => {
		const prevFileNames = previousChangeFileNamesRef.current;

		setIncludedFileNames((prevIncluded) => {
			const nextIncluded = reconcileIncludedFiles(
				changeFileNames,
				prevIncluded,
				prevFileNames,
			);
			return areSetsEqual(prevIncluded, nextIncluded)
				? prevIncluded
				: nextIncluded;
		});

		previousChangeFileNamesRef.current = new Set(changeFileNames);
	}, [changeFileNames]);

	// Derived clamp — the file list shrinks when changes are committed/discarded.
	const clampedSelectedIndex = Math.min(
		selectedIndex,
		Math.max(changesFiles.length - 1, 0),
	);

	const handleToggleIncluded = useCallback(
		(fileName: string, included: boolean) => {
			setIncludedFileNames((prev) =>
				toggleIncludedFileName(prev, fileName, included),
			);
		},
		[],
	);

	const handleIncludeAll = useCallback(() => {
		setIncludedFileNames(new Set(changeFileNames));
	}, [changeFileNames]);

	const handleIncludeNone = useCallback(() => {
		setIncludedFileNames(new Set());
	}, []);

	// Double-click jumps into the diff dialog focused on that file.
	const handleOpenFile = useCallback(
		(file: FileDiffMetadata) => {
			const index = changesFiles.findIndex((f) => f.name === file.name);
			dispatchDiffDialog({ type: "switchTab", tab: "changes" });
			if (index > 0) {
				dispatchDiffDialog({ type: "selectFile", index });
			}
			setDiffDialogOpen(true);
		},
		[changesFiles],
	);

	const handleDiscardFile = useCallback(
		async (file: FileDiffMetadata) => {
			const relativePaths = Array.from(
				new Set(
					[file.name, file.prevName].filter((path): path is string =>
						Boolean(path),
					),
				),
			);
			const absolutePaths = relativePaths.map((path) =>
				resolveWorktreeFilePath(worktreePath, path),
			);

			try {
				await discardGitFileChanges({
					paths: relativePaths,
					filePathsToRefresh: absolutePaths,
				});
				toast.success(m.gitDiscardFileSuccessTitle(), {
					description: m.gitDiscardFileSuccessDescription({
						file: file.name,
					}),
				});
			} catch (error) {
				toast.error(m.gitDiscardFileErrorTitle(), {
					description:
						error instanceof Error ? error.message : String(error),
				});
			}
		},
		[discardGitFileChanges, worktreePath],
	);

	const handleCommit = useCallback(async () => {
		try {
			const hash = await commitGitChanges({
				files: orderedIncludedFileNames,
				message: commitMessage.trim(),
				body: commitBody.trim() || undefined,
			});
			setCommitMessage("");
			setCommitBody("");
			toast.success(m.gitCommitSuccessTitle(), {
				description: m.gitCommitSuccessDescription({
					hash: hash.slice(0, 7),
				}),
			});
		} catch (error) {
			toast.error(m.gitCommitErrorTitle(), {
				description:
					error instanceof Error ? error.message : String(error),
			});
		}
	}, [commitBody, commitGitChanges, commitMessage, orderedIncludedFileNames]);

	const handleMaximize = useCallback(() => {
		dispatchDiffDialog({ type: "switchTab", tab: "changes" });
		setDiffDialogOpen(true);
	}, []);
	const handleCloseDiffDialog = useCallback(() => {
		setDiffDialogOpen(false);
	}, []);

	const handlePush = useCallback(async () => {
		try {
			await gitPush();
			toast.success(m.gitPushSuccessTitle());
		} catch (error) {
			toast.error(m.gitPushErrorTitle(), {
				description:
					error instanceof Error ? error.message : String(error),
			});
		}
	}, [gitPush]);

	return (
		<>
		<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<ChangesFileList
				files={changesFiles}
				selectedIndex={clampedSelectedIndex}
				includedFileNames={includedFileNames}
				onSelect={setSelectedIndex}
				onToggleIncluded={handleToggleIncluded}
				onOpenFile={handleOpenFile}
				onDiscardFile={handleDiscardFile}
				onIncludeAll={handleIncludeAll}
				onIncludeNone={handleIncludeNone}
				onMaximize={handleMaximize}
				tooltipsDisabled
				emptyMessage={m.noChangesDetected()}
			/>
			<CommitComposer
				commitMessage={commitMessage}
				commitBody={commitBody}
				includedCount={includedFileNames.size}
				totalCount={changesFiles.length}
				isPending={isCommitting}
				aheadCount={aheadCount}
				isPushing={isPushing}
				onMessageChange={setCommitMessage}
				onBodyChange={setCommitBody}
				onSubmit={handleCommit}
				onPush={handlePush}
			/>
		</div>

		<GitDiffDialog
			isOpen={diffDialogOpen}
			onClose={handleCloseDiffDialog}
			profileId={profileId}
			worktreePath={worktreePath}
			branchName={branchName ?? undefined}
			state={diffDialogState}
			dispatch={dispatchDiffDialog}
		/>
		</>
	);
}
