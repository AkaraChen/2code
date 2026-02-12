import {
	Flex,
	HStack,
	IconButton,
	Spinner,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { RiArrowLeftLine } from "react-icons/ri";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { FileListItem } from "./ChangesFileList";

export interface HistoryFileListProps {
	commit: GitCommit | null;
	files: FileDiffMetadata[];
	selectedIndex: number;
	isLoading: boolean;
	onFileSelect: (index: number) => void;
	onBack: () => void;
}

function CommitHeader({
	commit,
	onBack,
}: {
	commit: GitCommit;
	onBack: () => void;
}) {
	return (
		<HStack px="2" py="1" gap="1">
			<IconButton
				size="xs"
				variant="ghost"
				aria-label={m.backToCommitList()}
				onClick={onBack}
			>
				<RiArrowLeftLine />
			</IconButton>
			<VStack align="start" gap="0" flex="1" minW="0">
				<Text fontSize="sm" fontWeight="medium" lineClamp={1}>
					{commit.message}
				</Text>
				<Text fontSize="xs" color="fg.muted" fontFamily="mono">
					{commit.hash}
				</Text>
			</VStack>
		</HStack>
	);
}

export default function HistoryFileList({
	commit,
	files,
	selectedIndex,
	isLoading,
	onFileSelect,
	onBack,
}: HistoryFileListProps) {
	if (!commit) return null;

	return (
		<>
			<CommitHeader commit={commit} onBack={onBack} />
			{isLoading ? (
				<Flex align="center" justify="center" flex="1">
					<Spinner size="sm" />
				</Flex>
			) : files.length === 0 ? (
				<Flex align="center" justify="center" flex="1" p="8">
					<Text color="fg.muted" fontSize="sm">
						{m.noFileChanges()}
					</Text>
				</Flex>
			) : (
				<>
					<Text px="3" py="1" fontSize="xs" color="fg.muted">
						{m.changedFiles({ count: files.length })}
					</Text>
					{files.map((file, i) => (
						<FileListItem
							key={file.name + i}
							file={file}
							isActive={selectedIndex === i}
							onClick={() => onFileSelect(i)}
						/>
					))}
				</>
			)}
		</>
	);
}
