import { memo, use, useCallback, useMemo } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import * as m from "@/paraglide/messages.js";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import ChangesFileList from "./ChangesFileList";
import CommitComposer from "./CommitComposer";
import GitDiffPane from "./GitDiffPane";
import { GitDiffContext } from "../gitDiffReducer";
import type { DiffReviewComment } from "../reviewQueue";

// CSS display toggle — never unmounts children (preserves diff pane scroll)
function VisibleBox({
	visible,
	children,
}: {
	visible: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex-1" style={{ display: visible ? "flex" : "none" }}>
			{children}
		</div>
	);
}

interface ChangesSidebarProps {
	includedFileNames: Set<string>;
	commitMessage: string;
	commitBody: string;
	isCommitting: boolean;
	aheadCount: number;
	isPushing: boolean;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onOpenFile: (file: FileDiffMetadata) => void;
	onDiscardFile: (file: FileDiffMetadata) => Promise<void>;
	onIncludeAll: () => void;
	onIncludeNone: () => void;
	onCommitMessageChange: (value: string) => void;
	onCommitBodyChange: (value: string) => void;
	onCommit: () => void;
	onPush: () => void;
}

export const ChangesSidebar = memo(({
	includedFileNames,
	commitMessage,
	commitBody,
	isCommitting,
	aheadCount,
	isPushing,
	onToggleIncluded,
	onOpenFile,
	onDiscardFile,
	onIncludeAll,
	onIncludeNone,
	onCommitMessageChange,
	onCommitBodyChange,
	onCommit,
	onPush,
}: ChangesSidebarProps) => {
	const { changesFiles, state, dispatch } = use(GitDiffContext)!;
	const handleSelectFile = useCallback(
		(index: number) => {
			dispatch({ type: "selectFile", index });
		},
		[dispatch],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			{changesFiles.length === 0 ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-8">
					<p className="text-sm text-muted-foreground">
						{m.noChangesDetected()}
					</p>
				</div>
			) : (
				<ChangesFileList
					files={changesFiles}
					selectedIndex={state.selectedFileIndex}
					includedFileNames={includedFileNames}
					onSelect={handleSelectFile}
					onToggleIncluded={onToggleIncluded}
					onOpenFile={onOpenFile}
					onDiscardFile={onDiscardFile}
					onIncludeAll={onIncludeAll}
					onIncludeNone={onIncludeNone}
				/>
			)}
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
		</div>
	);
});

export const ChangesDiffPane = memo(({
	visible,
	onAddReviewComment,
}: {
	visible: boolean;
	onAddReviewComment?: (comment: DiffReviewComment) => void;
}) => {
	const { changesFiles, state, options, profileId } = use(GitDiffContext)!;
	const previewContext = useMemo(
		() => ({ kind: "working-tree" as const, profileId }),
		[profileId],
	);
	const activeFile =
		changesFiles.length > 0 && state.selectedFileIndex < changesFiles.length
			? changesFiles[state.selectedFileIndex]
			: null;

	return (
		<VisibleBox visible={visible}>
			<AsyncBoundary
				fallback={<LoadingSpinner />}
				errorFallback={({ error, onRetry }) => (
					<LoadingError error={error} onRetry={onRetry} />
				)}
			>
				<GitDiffPane
					activeFile={activeFile}
					options={options}
					contextKey="working-tree"
					previewContext={previewContext}
					onAddReviewComment={onAddReviewComment}
					emptyMessage={
						changesFiles.length === 0
							? m.noChangesDetected()
							: m.selectFileToView()
					}
				/>
			</AsyncBoundary>
		</VisibleBox>
	);
});
