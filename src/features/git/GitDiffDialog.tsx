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
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useListKeyNav } from "@/shared/hooks/useListKeyNav";
import { RiGitBranchLine } from "react-icons/ri";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import ChangesFileList from "./components/ChangesFileList";
import CommitList from "./components/CommitList";
import GitDiffPane from "./components/GitDiffPane";
import HistoryFileList from "./components/HistoryFileList";
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
								<HStack gap="1.5" alignItems={"center"}>
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
							<GitDiffContent profileId={profileId} />
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

	const [activeTab, setActiveTab] = useState<string>("changes");
	const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(
		null,
	);

	const sidebarRef = useRef<HTMLDivElement>(null);
	const commitsRef = useRef<GitCommit[]>([]);

	const [selectedFileIndex, setSelectedFileIndex, changesFileCountRef] =
		useListKeyNav();
	const [selectedCommitIndex, setSelectedCommitIndex, commitCountRef] =
		useListKeyNav();
	const [
		selectedCommitFileIndex,
		setSelectedCommitFileIndex,
		commitFileCountRef,
	] = useListKeyNav();

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

	const handleTabChange = useCallback((value: string) => {
		startTransition(() => {
			setActiveTab(value);
			setSelectedCommit(null);
			setSelectedCommitFileIndex(0);
			setSelectedCommitIndex(0);
		});
	}, []);

	const handleCommitSelect = useCallback(
		(commit: GitCommit, index: number) => {
			startTransition(() => {
				setSelectedCommit(commit);
				setSelectedCommitFileIndex(0);
				setSelectedCommitIndex(index);
			});
		},
		[],
	);

	const handleCommitBack = useCallback(() => {
		startTransition(() => {
			setSelectedCommit(null);
			setSelectedCommitFileIndex(0);
			// selectedCommitIndex intentionally preserved
		});
	}, []);

	// Keyboard navigation — dispatch arrow keys to the active list,
	// handle Enter / Escape / Backspace for commit drill-in/back.
	const activeListKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const delta = e.key === "ArrowDown" ? 1 : -1;
				const step =
					(setter: typeof setSelectedFileIndex, count: React.RefObject<number>) =>
						setter((prev) => Math.max(0, Math.min(prev + delta, count.current - 1)));

				if (activeTab === "changes") {
					step(setSelectedFileIndex, changesFileCountRef);
				} else if (selectedCommit) {
					step(setSelectedCommitFileIndex, commitFileCountRef);
				} else {
					step(setSelectedCommitIndex, commitCountRef);
				}
				return;
			}

			if (
				e.key === "Enter" &&
				activeTab === "history" &&
				!selectedCommit
			) {
				e.preventDefault();
				const commits = commitsRef.current;
				if (
					commits.length > 0 &&
					selectedCommitIndex < commits.length
				) {
					handleCommitSelect(
						commits[selectedCommitIndex],
						selectedCommitIndex,
					);
				}
				return;
			}

			if (activeTab === "history" && selectedCommit) {
				if (e.key === "Backspace") {
					e.preventDefault();
					handleCommitBack();
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					handleCommitBack();
					return;
				}
			}
		},
		[
			activeTab,
			selectedCommit,
			selectedCommitIndex,
			changesFileCountRef,
			commitCountRef,
			commitFileCountRef,
			setSelectedFileIndex,
			setSelectedCommitIndex,
			setSelectedCommitFileIndex,
			handleCommitSelect,
			handleCommitBack,
		],
	);

	// Auto-focus sidebar on tab change (also covers initial dialog open)
	useEffect(() => {
		const timer = setTimeout(() => {
			sidebarRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [activeTab]);

	// Re-focus sidebar when returning from commit files to commit list
	useEffect(() => {
		if (!selectedCommit) {
			sidebarRef.current?.focus();
		}
	}, [selectedCommit]);

	const isChanges = activeTab === "changes";

	return (
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
					value={activeTab}
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
								<ChangesSidebar
									profileId={profileId}
									selectedFileIndex={selectedFileIndex}
									onFileSelect={setSelectedFileIndex}
									countRef={changesFileCountRef}
								/>
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
								<HistorySidebar
									profileId={profileId}
									selectedCommit={selectedCommit}
									selectedCommitIndex={selectedCommitIndex}
									selectedCommitFileIndex={
										selectedCommitFileIndex
									}
									onCommitSelect={handleCommitSelect}
									onCommitFileSelect={
										setSelectedCommitFileIndex
									}
									onCommitBack={handleCommitBack}
									commitCountRef={commitCountRef}
									commitFileCountRef={commitFileCountRef}
									commitsRef={commitsRef}
								/>
							</Suspense>
						</Box>
					</Activity>
				</Tabs.Root>
			</Flex>

			{/* Pane column */}
			<Activity mode={isChanges ? "visible" : "hidden"}>
				<Suspense fallback={null}>
					<ChangesDiffPane
						profileId={profileId}
						selectedFileIndex={selectedFileIndex}
						options={options}
						visible={isChanges}
					/>
				</Suspense>
			</Activity>

			<Activity mode={!isChanges ? "visible" : "hidden"}>
				<Suspense fallback={null}>
					<HistoryDiffPane
						profileId={profileId}
						selectedCommit={selectedCommit}
						selectedCommitFileIndex={selectedCommitFileIndex}
						options={options}
						visible={!isChanges}
					/>
				</Suspense>
			</Activity>
		</Flex>
	);
}

// ---------------------------------------------------------------------------
// Changes tab components
// ---------------------------------------------------------------------------

function ChangesSidebar({
	profileId,
	selectedFileIndex,
	onFileSelect,
	countRef,
}: {
	profileId: string;
	selectedFileIndex: number;
	onFileSelect: (index: number) => void;
	countRef: React.RefObject<number>;
}) {
	const files = useGitDiffFiles(profileId);
	countRef.current = files.length;

	if (files.length === 0) {
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
				files={files}
				selectedIndex={selectedFileIndex}
				onSelect={onFileSelect}
			/>
		</Box>
	);
}

function ChangesDiffPane({
	profileId,
	selectedFileIndex,
	options,
	visible,
}: {
	profileId: string;
	selectedFileIndex: number;
	options: FileDiffOptions<unknown>;
	visible: boolean;
}) {
	const files = useGitDiffFiles(profileId);
	const activeFile =
		files.length > 0 && selectedFileIndex < files.length
			? files[selectedFileIndex]
			: null;

	return (
		<Box flex="1" display={visible ? "flex" : "none"}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				emptyMessage={
					files.length === 0
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

function HistorySidebar({
	profileId,
	selectedCommit,
	selectedCommitIndex,
	selectedCommitFileIndex,
	onCommitSelect,
	onCommitFileSelect,
	onCommitBack,
	commitCountRef,
	commitFileCountRef,
	commitsRef,
}: {
	profileId: string;
	selectedCommit: GitCommit | null;
	selectedCommitIndex: number;
	selectedCommitFileIndex: number;
	onCommitSelect: (commit: GitCommit, index: number) => void;
	onCommitFileSelect: (index: number) => void;
	onCommitBack: () => void;
	commitCountRef: React.RefObject<number>;
	commitFileCountRef: React.RefObject<number>;
	commitsRef: React.RefObject<GitCommit[]>;
}) {
	const { data: logData } = useGitLog(profileId);
	const commits = logData ?? [];
	commitsRef.current = commits;
	commitCountRef.current = commits.length;

	if (selectedCommit) {
		return (
			<Box
				flex="1"
				display="flex"
				flexDirection="column"
				minH="0"
				overflow="hidden"
			>
				<CommitFileSidebar
					profileId={profileId}
					commit={selectedCommit}
					selectedCommitFileIndex={selectedCommitFileIndex}
					onCommitFileSelect={onCommitFileSelect}
					onCommitBack={onCommitBack}
					countRef={commitFileCountRef}
				/>
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
			selectedIndex={selectedCommitIndex}
			onCommitSelect={onCommitSelect}
		/>
	);
}

function CommitFileSidebar({
	profileId,
	commit,
	selectedCommitFileIndex,
	onCommitFileSelect,
	onCommitBack,
	countRef,
}: {
	profileId: string;
	commit: GitCommit;
	selectedCommitFileIndex: number;
	onCommitFileSelect: (index: number) => void;
	onCommitBack: () => void;
	countRef: React.RefObject<number>;
}) {
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	countRef.current = files.length;

	return (
		<HistoryFileList
			commit={commit}
			files={files}
			selectedIndex={selectedCommitFileIndex}
			onFileSelect={onCommitFileSelect}
			onBack={onCommitBack}
		/>
	);
}

function HistoryDiffPane({
	profileId,
	selectedCommit,
	selectedCommitFileIndex,
	options,
	visible,
}: {
	profileId: string;
	selectedCommit: GitCommit | null;
	selectedCommitFileIndex: number;
	options: FileDiffOptions<unknown>;
	visible: boolean;
}) {
	if (!selectedCommit) {
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

	return (
		<CommitDiffViewer
			profileId={profileId}
			commit={selectedCommit}
			selectedCommitFileIndex={selectedCommitFileIndex}
			options={options}
			visible={visible}
		/>
	);
}

function CommitDiffViewer({
	profileId,
	commit,
	selectedCommitFileIndex,
	options,
	visible,
}: {
	profileId: string;
	commit: GitCommit;
	selectedCommitFileIndex: number;
	options: FileDiffOptions<unknown>;
	visible: boolean;
}) {
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const activeFile =
		files.length > 0 && selectedCommitFileIndex < files.length
			? files[selectedCommitFileIndex]
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
