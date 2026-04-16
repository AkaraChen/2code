import {
	Box,
	Button,
	HStack,
	Text,
} from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { FileListItem } from "./FileListItem";

interface ChangesFileListProps {
	files: FileDiffMetadata[];
	selectedIndex: number;
	includedFileNames: Set<string>;
	onSelect: (index: number) => void;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onIncludeAll: () => void;
	onIncludeNone: () => void;
}

export default function ChangesFileList({
	files,
	selectedIndex,
	includedFileNames,
	onSelect,
	onToggleIncluded,
	onIncludeAll,
	onIncludeNone,
}: ChangesFileListProps) {
	const { ref: containerRef } =
		useScrollIntoView<HTMLDivElement>(selectedIndex);
	const includedCount = includedFileNames.size;

	return (
		<Box ref={containerRef} flex="1" overflowY="auto" minH="0">
			<HStack
				position="sticky"
				top="0"
				zIndex="1"
				justify="space-between"
				px="3"
				py="2.5"
				bg="bg.subtle"
				borderBottomWidth="1px"
				borderColor="border.subtle"
			>
				<Text fontSize="xs" color="fg.muted">
					{m.changedFiles({ count: files.length })}
				</Text>
				<HStack gap="1">
					<Button
						size="xs"
						variant="ghost"
						onClick={onIncludeAll}
						disabled={includedCount === files.length}
					>
						{m.gitCommitIncludeAll()}
					</Button>
					<Button
						size="xs"
						variant="ghost"
						onClick={onIncludeNone}
						disabled={includedCount === 0}
					>
						{m.gitCommitIncludeNone()}
					</Button>
				</HStack>
			</HStack>
			{files.map((file, i) => (
				<div key={file.name} data-index={i}>
					<FileListItem
						file={file}
						isActive={selectedIndex === i}
						isIncluded={includedFileNames.has(file.name)}
						onClick={() => onSelect(i)}
						onToggleIncluded={(included) =>
							onToggleIncluded(file.name, included)
						}
					/>
				</div>
			))}
		</Box>
	);
}
