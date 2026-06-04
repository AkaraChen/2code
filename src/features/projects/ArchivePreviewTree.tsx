import { Box, Flex, Text } from "@chakra-ui/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import type { ArchivePreviewEntry } from "@/generated";

const ARCHIVE_TREE_HOST_STYLE = {
	height: "100%",
	minWidth: 0,
	width: "100%",
	"--trees-bg-muted-override": "var(--chakra-colors-bg-subtle)",
	"--trees-bg-override": "transparent",
	"--trees-border-radius-override": "4px",
	"--trees-fg-muted-override": "var(--chakra-colors-fg-muted)",
	"--trees-fg-override": "var(--chakra-colors-fg-muted)",
	"--trees-font-family-override": "inherit",
	"--trees-font-size-override": "13px",
	"--trees-item-margin-x-override": "4px",
	"--trees-item-padding-x-override": "4px",
	"--trees-level-gap-override": "12px",
	"--trees-padding-inline-override": "4px",
	"--trees-selected-bg-override": "var(--chakra-colors-bg-subtle)",
	"--trees-selected-fg-override": "var(--chakra-colors-fg)",
} as CSSProperties;

interface ArchivePreviewTreeProps {
	entries: readonly ArchivePreviewEntry[];
	fileName: string;
}

function addParentDirectories(path: string, directories: Set<string>) {
	let slashIndex = path.lastIndexOf("/");
	while (slashIndex > 0) {
		directories.add(`${path.slice(0, slashIndex)}/`);
		slashIndex = path.lastIndexOf("/", slashIndex - 1);
	}
}

export default function ArchivePreviewTree({
	entries,
	fileName,
}: ArchivePreviewTreeProps) {
	const { expandedPaths, fileCount, paths } = useMemo(() => {
		const paths: string[] = [];
		const expandedDirectories = new Set<string>();
		let fileCount = 0;

		for (const entry of entries) {
			paths.push(entry.path);
			if (entry.kind === "file") {
				fileCount += 1;
				addParentDirectories(entry.path, expandedDirectories);
				continue;
			}

			expandedDirectories.add(entry.path);
			addParentDirectories(entry.path.replace(/\/$/, ""), expandedDirectories);
		}

		return {
			expandedPaths: [...expandedDirectories],
			fileCount,
			paths,
		};
	}, [entries]);
	const directoryCount = entries.length - fileCount;
	const { model } = useFileTree({
		density: "compact",
		flattenEmptyDirectories: false,
		gitStatus: [],
		icons: "complete",
		initialExpansion: "open",
		paths: [],
		stickyFolders: true,
	});

	useEffect(() => {
		model.resetPaths(paths, { initialExpandedPaths: expandedPaths });
	}, [expandedPaths, model, paths]);

	return (
		<Flex h="full" minH="0" direction="column" overflow="hidden">
			<Flex
				align="center"
				justify="space-between"
				gap="3"
				minH="9"
				px="3"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				bg="bg.subtle"
			>
				<Text fontSize="sm" fontWeight="medium" truncate>
					{fileName}
				</Text>
				<Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
					{fileCount} files / {directoryCount} folders
				</Text>
			</Flex>

			<Box flex="1" minH="0" minW="0" overflow="hidden" px="1.5" py="1">
				<FileTree model={model} style={ARCHIVE_TREE_HOST_STYLE} />
			</Box>
		</Flex>
	);
}
