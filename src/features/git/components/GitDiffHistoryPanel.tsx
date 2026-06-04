import { Box, Flex } from "@chakra-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, startTransition, use, useCallback, useEffect, useMemo } from "react";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import CommitList from "./CommitList";
import GitDiffPane from "./GitDiffPane";
import HistoryFileList from "./HistoryFileList";
import { GitDiffContext } from "../gitDiffReducer";
import { useCommitDiffFiles } from "../hooks";

const HISTORY_PANEL_FADE_TRANSITION = {
	duration: 0.33,
	ease: [0.22, 1, 0.36, 1],
} as const;

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
					exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
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

const CommitFileSidebar = memo(({
	commit,
	selectedIndex,
}: {
	commit: GitCommit;
	selectedIndex: number;
}) => {
	const { profileId, dispatch } = use(GitDiffContext)!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const handleFileSelect = useCallback(
		(index: number) => {
			dispatch({ type: "selectCommitFile", index });
		},
		[dispatch],
	);
	const handleBack = useCallback(() => {
		startTransition(() => {
			dispatch({ type: "commitBack" });
		});
	}, [dispatch]);

	useEffect(() => {
		dispatch({ type: "setCommitFileCount", count: files.length });
	}, [dispatch, files.length]);

	return (
		<HistoryFileList
			commit={commit}
			files={files}
			selectedIndex={selectedIndex}
			onFileSelect={handleFileSelect}
			onBack={handleBack}
		/>
	);
});

const CommitDiffViewer = memo(({
	commit,
	selectedIndex,
}: {
	commit: GitCommit;
	selectedIndex: number;
}) => {
	const { profileId, options } = use(GitDiffContext)!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const previewContext = useMemo(
		() => ({ kind: "commit" as const, profileId, commitHash: commit.full_hash }),
		[commit.full_hash, profileId],
	);
	const activeFile =
		files.length > 0 && selectedIndex < files.length
			? files[selectedIndex]
			: null;

	return (
		<GitDiffPane
			activeFile={activeFile}
			options={options}
			contextKey={commit.full_hash}
			previewContext={previewContext}
			emptyMessage={m.selectFileToView()}
		/>
	);
});

export const HistorySidebar = memo(() => {
	const { commits, state, dispatch } = use(GitDiffContext)!;
	const selectedCommit = state.selectedCommit;
	const handleCommitSelect = useCallback(
		(commit: GitCommit, index: number) => {
			startTransition(() => {
				dispatch({ type: "selectCommit", commit, index });
			});
		},
		[dispatch],
	);

	if (selectedCommit) {
		return (
			<HistorySidebarPanel panelKey={`commit:${selectedCommit.full_hash}`}>
				<AsyncBoundary
					fallback={<LoadingSpinner size="sm" />}
					errorFallback={({ error, onRetry }) => (
						<LoadingError error={error} onRetry={onRetry} size="sm" />
					)}
				>
					<CommitFileSidebar
						commit={selectedCommit}
						selectedIndex={state.selectedCommitFileIndex}
					/>
				</AsyncBoundary>
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
				onCommitSelect={handleCommitSelect}
			/>
		</HistorySidebarPanel>
	);
});

export const HistoryDiffPane = memo(({ visible }: { visible: boolean }) => {
	const { state, options, profileId } = use(GitDiffContext)!;
	const selectedCommit = state.selectedCommit;
	const emptyPreviewContext = useMemo(
		() => ({ kind: "working-tree" as const, profileId }),
		[profileId],
	);

	if (!selectedCommit) {
		return (
			<VisibleBox visible={visible}>
				<HistorySidebarPanel panelKey="history-empty">
					<GitDiffPane
						activeFile={null}
						options={options}
						contextKey="history"
						previewContext={emptyPreviewContext}
						emptyMessage={m.selectFileToView()}
					/>
				</HistorySidebarPanel>
			</VisibleBox>
		);
	}

	return (
		<VisibleBox visible={visible}>
			<HistorySidebarPanel panelKey={`history:${selectedCommit.full_hash}`}>
				<AsyncBoundary
					fallback={<LoadingSpinner />}
					errorFallback={({ error, onRetry }) => (
						<LoadingError error={error} onRetry={onRetry} />
					)}
				>
					<CommitDiffViewer
						commit={selectedCommit}
						selectedIndex={state.selectedCommitFileIndex}
					/>
				</AsyncBoundary>
			</HistorySidebarPanel>
		</VisibleBox>
	);
});
