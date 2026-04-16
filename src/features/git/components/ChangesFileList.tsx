import {
	Badge,
	Button,
	Checkbox,
	HStack,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { changeBadge } from "../utils";

interface FileListItemProps {
	file: FileDiffMetadata;
	isActive: boolean;
	isIncluded?: boolean;
	onClick: () => void;
	onToggleIncluded?: (included: boolean) => void;
}

function FileListItem({
	file,
	isActive,
	isIncluded,
	onClick,
	onToggleIncluded,
}: FileListItemProps) {
	const badge = changeBadge[file.type] ?? changeBadge.change;
	const basename = file.name.split("/").pop() ?? file.name;
	const effectiveIncluded = isIncluded ?? true;
	const parentPath = file.name.includes("/")
		? file.name.split("/").slice(0, -1).join("/")
		: null;

	return (
		<HStack
			px="3"
			py="2"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isActive ? "bg.emphasized" : "bg.subtle" }}
			onClick={onClick}
			gap="2"
			userSelect="none"
			opacity={effectiveIncluded ? 1 : 0.72}
			align="flex-start"
			w="full"
			minW="0"
			overflow="hidden"
		>
			{onToggleIncluded ? (
				<Checkbox.Root
					mt="0.5"
					size="sm"
					checked={effectiveIncluded}
					onClick={(event) => event.stopPropagation()}
					onCheckedChange={(event) =>
						onToggleIncluded(!!event.checked)
					}
				>
					<Checkbox.HiddenInput />
					<Checkbox.Control />
				</Checkbox.Root>
			) : null}

			<VStack flex="1" align="stretch" gap="0" minW="0">
				<HStack gap="2" minW="0" w="full" overflow="hidden">
					<Text
						fontSize="sm"
						fontWeight={isActive ? "medium" : "normal"}
						flex="1"
						minW="0"
						maxW={parentPath ? "55%" : undefined}
						truncate
						title={file.name}
					>
						{basename}
					</Text>
					{parentPath && (
						<Text
							fontSize="xs"
							color="fg.muted"
							flex="1"
							minW="0"
							truncate
							title={file.name}
						>
							{parentPath}
						</Text>
					)}
					<Badge
						size="xs"
						colorPalette={badge.colorPalette}
						variant="subtle"
						marginStart="auto"
						flexShrink={0}
					>
						{badge.label}
					</Badge>
				</HStack>
			</VStack>
		</HStack>
	);
}

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
		<div ref={containerRef}>
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
				<VStack align="start" gap="0">
					<Text fontSize="xs" color="fg.muted">
						{m.changedFiles({ count: files.length })}
					</Text>
				</VStack>
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
		</div>
	);
}

export { FileListItem };
