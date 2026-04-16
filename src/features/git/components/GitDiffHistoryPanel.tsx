import { Box, Flex } from "@chakra-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Suspense, startTransition, use, useEffect } from "react";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { LoadingSpinner } from "@/shared/components/Fallbacks";
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
			onFileSelect={(i) => dispatch({ type: "selectCommitFile", index: i })}
			onBack={() =>
				startTransition(() => {
					dispatch({ type: "commitBack" });
				})
			}
		/>
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
			previewContext={{ kind: "commit", profileId, commitHash: commit.full_hash }}
			emptyMessage={m.selectFileToView()}
		/>
	);
}

export function HistorySidebar() {
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

export function HistoryDiffPane({ visible }: { visible: boolean }) {
	const { state, options, profileId } = use(GitDiffContext)!;
	const selectedCommit = state.selectedCommit;

	if (!selectedCommit) {
		return (
			<VisibleBox visible={visible}>
				<HistorySidebarPanel panelKey="history-empty">
					<GitDiffPane
						activeFile={null}
						options={options}
						contextKey="history"
						previewContext={{ kind: "working-tree", profileId }}
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
