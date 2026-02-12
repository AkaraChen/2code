import { Badge, Box, Flex, Spinner, Text } from "@chakra-ui/react";
import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useFontStore } from "@/features/settings/stores/fontStore";

const changeTypeBadge: Record<string, { label: string; colorPalette: string }> =
	{
		new: { label: "A", colorPalette: "green" },
		deleted: { label: "D", colorPalette: "red" },
		change: { label: "M", colorPalette: "blue" },
		"rename-pure": { label: "R", colorPalette: "yellow" },
		"rename-changed": { label: "R", colorPalette: "yellow" },
	};

function getLineStats(file: FileDiffMetadata) {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const content of hunk.hunkContent) {
			if (content.type === "change") {
				additions += content.additions.length;
				deletions += content.deletions.length;
			}
		}
	}
	return { additions, deletions };
}

function FileDiffHeader({ file }: { file: FileDiffMetadata }) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeTypeBadge[file.type] ?? changeTypeBadge.change;
	const displayName =
		file.prevName && file.prevName !== file.name
			? `${file.prevName} → ${file.name}`
			: file.name;

	return (
		<Flex px="3" py="1.5" userSelect="none" gap="3" align="center" bg={"bg.subtle"}>
			<Badge bg={`${badge.colorPalette}.solid`} color="white" fontSize="xs" fontFamily="mono">
				{badge.label}
			</Badge>
			<Text fontSize="sm" fontFamily="mono" flex="1" truncate>
				{displayName}
			</Text>
			<Flex gap="2" fontSize="xs" fontFamily="mono">
				{additions > 0 && <Text color="green.solid">+{additions}</Text>}
				{deletions > 0 && <Text color="red.solid">-{deletions}</Text>}
			</Flex>
		</Flex>
	);
}

export interface GitDiffPaneProps {
	activeFile: FileDiffMetadata | null;
	options: FileDiffOptions<unknown>;
	isLoading: boolean;
	activeTab: string;
	tabFiles: FileDiffMetadata[];
}

export default function GitDiffPane({
	activeFile,
	options,
	isLoading,
	activeTab,
	tabFiles,
}: GitDiffPaneProps) {
	const getEmptyMessage = () => {
		if (activeTab === "changes") {
			return tabFiles.length === 0
				? "No changes detected"
				: "Select a file to view changes";
		}
		return "Select a file to view changes";
	};
	const fontFamily = useFontStore((s) => s.fontFamily);
	const fontSize = useFontStore((s) => s.fontSize);

	return (
		<Box
			flex="1"
			overflow="auto"
			css={{
				"--diffs-font-family": `"${fontFamily}", monospace`,
				"--diffs-font-size": `${fontSize}px`,
			}}
		>
			{isLoading ? (
				<Flex align="center" justify="center" flex="1" h="full">
					<Spinner />
				</Flex>
			) : activeFile ? (
				<>
					<FileDiffHeader file={activeFile} />
					<FileDiff fileDiff={activeFile} options={options} />
				</>
			) : (
				<Flex align="center" justify="center" h="full" p="8">
					<Text color="fg.muted" fontSize="sm">
						{getEmptyMessage()}
					</Text>
				</Flex>
			)}
		</Box>
	);
}
