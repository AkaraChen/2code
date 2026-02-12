import { Badge, HStack, Text } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useMemo } from "react";
import * as m from "@/paraglide/messages.js";
import { changeBadge, getLineStats } from "../utils";

interface FileListItemProps {
	file: FileDiffMetadata;
	isActive: boolean;
	onClick: () => void;
}

function FileListItem({ file, isActive, onClick }: FileListItemProps) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeBadge[file.type] ?? changeBadge.change;
	const basename = file.name.split("/").pop() ?? file.name;

	return (
		<HStack
			px="3"
			py="1"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isActive ? "bg.emphasized" : "bg.muted" }}
			onClick={onClick}
			gap="2"
			userSelect="none"
		>
			<Badge size="xs" colorPalette={badge.colorPalette} variant="subtle">
				{badge.label}
			</Badge>
			<Text fontSize="sm" flex="1" truncate title={file.name}>
				{basename}
			</Text>
			<HStack gap="1" fontSize="xs" flexShrink={0}>
				{additions > 0 && (
					<Text color="green.solid" lineHeight="1">
						+{additions}
					</Text>
				)}
				{deletions > 0 && (
					<Text color="red.solid" lineHeight="1">
						-{deletions}
					</Text>
				)}
			</HStack>
		</HStack>
	);
}

export interface ChangesFileListProps {
	files: FileDiffMetadata[];
	selectedIndex: number;
	onSelect: (index: number) => void;
}

export default function ChangesFileList({
	files,
	selectedIndex,
	onSelect,
}: ChangesFileListProps) {
	return (
		<>
			<Text px="3" py="1" fontSize="xs" color="fg.muted">
				{m.changedFiles({ count: files.length })}
			</Text>
			{files.map((file, i) => (
				<FileListItem
					key={file.name + i}
					file={file}
					isActive={selectedIndex === i}
					onClick={() => onSelect(i)}
				/>
			))}
		</>
	);
}

export { FileListItem };
