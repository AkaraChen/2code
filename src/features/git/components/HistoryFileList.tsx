import { Box, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { RiArrowLeftLine } from "react-icons/ri";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { FileListItem } from "./ChangesFileList";

export interface HistoryFileListProps {
	commit: GitCommit;
	files: FileDiffMetadata[];
	selectedIndex: number;
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
	onFileSelect,
	onBack,
}: HistoryFileListProps) {
	return (
		<Flex direction="column" flex="1" minH="0" overflow="hidden">
			<CommitHeader commit={commit} onBack={onBack} />
			{files.length === 0 ? (
				<Flex align="center" justify="center" flex="1" p="8">
					<Text color="fg.muted" fontSize="sm">
						{m.noFileChanges()}
					</Text>
				</Flex>
			) : (
				<>
					<Text
						px="3"
						py="1"
						fontSize="xs"
						color="fg.muted"
						flexShrink={0}
					>
						{m.changedFiles({ count: files.length })}
					</Text>
					<Box flex="1" overflowY="auto" minH="0">
						{files.map((file, i) => (
							<FileListItem
								key={file.name + i}
								file={file}
								isActive={selectedIndex === i}
								onClick={() => onFileSelect(i)}
							/>
						))}
					</Box>
				</>
			)}
		</Flex>
	);
}
