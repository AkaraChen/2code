import { Box, Flex } from "@chakra-ui/react";
import { use } from "react";
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

// CSS display toggle — never unmounts children (preserves diff pane scroll)
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

export interface ChangesSidebarProps {
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

export function ChangesSidebar({
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
}: ChangesSidebarProps) {
	const { changesFiles, state, dispatch } = use(GitDiffContext)!;

	return (
		<Flex direction="column" flex="1" minH="0" overflow="hidden" bg="bg.subtle">
			{changesFiles.length === 0 ? (
				<Flex align="center" justify="center" flex="1" minH="0" p="8">
					<Box color="fg.muted" fontSize="sm">
						{m.noChangesDetected()}
					</Box>
				</Flex>
			) : (
				<ChangesFileList
					files={changesFiles}
					selectedIndex={state.selectedFileIndex}
					includedFileNames={includedFileNames}
					onSelect={(i) => dispatch({ type: "selectFile", index: i })}
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
		</Flex>
	);
}

export function ChangesDiffPane({ visible }: { visible: boolean }) {
	const { changesFiles, state, options, profileId } = use(GitDiffContext)!;
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
					previewContext={{ kind: "working-tree", profileId }}
					emptyMessage={
						changesFiles.length === 0
							? m.noChangesDetected()
							: m.selectFileToView()
					}
				/>
			</AsyncBoundary>
		</VisibleBox>
	);
}
