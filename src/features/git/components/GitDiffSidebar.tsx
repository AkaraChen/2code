import { Box, Flex, Tabs } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import ChangesFileList from "./ChangesFileList";
import CommitList from "./CommitList";
import HistoryFileList from "./HistoryFileList";

export interface GitDiffSidebarProps {
	activeTab: string;
	onTabChange: (value: string) => void;
	// Changes tab props
	changesFiles: FileDiffMetadata[];
	selectedFileIndex: number;
	onFileSelect: (index: number) => void;
	// History tab props
	logData: GitCommit[] | undefined;
	selectedCommit: GitCommit | null;
	commitFiles: FileDiffMetadata[];
	selectedCommitFileIndex: number;
	isCommitDiffLoading: boolean;
	onCommitSelect: (commit: GitCommit) => void;
	onCommitFileSelect: (index: number) => void;
	onCommitBack: () => void;
}

export default function GitDiffSidebar({
	activeTab,
	onTabChange,
	changesFiles,
	selectedFileIndex,
	onFileSelect,
	logData,
	selectedCommit,
	commitFiles,
	selectedCommitFileIndex,
	isCommitDiffLoading,
	onCommitSelect,
	onCommitFileSelect,
	onCommitBack,
}: GitDiffSidebarProps) {
	return (
		<Flex direction="column" w="320px" flexShrink={0} overflow="hidden">
			<Tabs.Root
				value={activeTab}
				onValueChange={(e) => onTabChange(e.value)}
				size="sm"
				variant="line"
				flex="1"
				display="flex"
				flexDirection="column"
			>
				<Tabs.List px="3">
					<Tabs.Trigger value="changes">{m.changes()}</Tabs.Trigger>
					<Tabs.Trigger value="history">{m.history()}</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content
					value="changes"
					p="0"
					flex="1"
					display="flex"
					flexDirection="column"
					overflow="hidden"
				>
					{changesFiles.length === 0 ? (
						<Flex align="center" justify="center" flex="1" p="8">
							<Box color="fg.muted" fontSize="sm">
								{m.noChangesDetected()}
							</Box>
						</Flex>
					) : (
						<Box flex="1" overflowY="auto">
							<ChangesFileList
								files={changesFiles}
								selectedIndex={selectedFileIndex}
								onSelect={onFileSelect}
							/>
						</Box>
					)}
				</Tabs.Content>
				<Tabs.Content
					value="history"
					p="0"
					flex="1"
					display="flex"
					flexDirection="column"
					overflow="hidden"
				>
					{selectedCommit ? (
						<Box flex="1" overflowY="auto">
							<HistoryFileList
								commit={selectedCommit}
								files={commitFiles}
								selectedIndex={selectedCommitFileIndex}
								isLoading={isCommitDiffLoading}
								onFileSelect={onCommitFileSelect}
								onBack={onCommitBack}
							/>
						</Box>
					) : (logData?.length ?? 0) === 0 ? (
						<Flex align="center" justify="center" flex="1" p="8">
							<Box color="fg.muted" fontSize="sm">
								{m.noCommitsFound()}
							</Box>
						</Flex>
					) : (
						<CommitList
							commits={logData ?? []}
							onCommitSelect={onCommitSelect}
						/>
					)}
				</Tabs.Content>
			</Tabs.Root>
		</Flex>
	);
}
