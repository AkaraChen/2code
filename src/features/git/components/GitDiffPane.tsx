import { Badge, Box, Flex, Text } from "@chakra-ui/react";
import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { changeBadge, getLineStats } from "../utils";

function FileDiffHeader({ file }: { file: FileDiffMetadata }) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeBadge[file.type] ?? changeBadge.change;
	const displayName =
		file.prevName && file.prevName !== file.name
			? `${file.prevName} → ${file.name}`
			: file.name;

	return (
		<Flex
			px="3"
			py="1.5"
			userSelect="none"
			gap="3"
			align="center"
			bg={"bg.panel"}
			roundedTop={"md"}
		>
			<Badge
				bg={`${badge.colorPalette}.solid`}
				color="white"
				fontSize="xs"
				fontFamily="mono"
			>
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
	emptyMessage: string;
}

export default function GitDiffPane({
	activeFile,
	options,
	emptyMessage,
}: GitDiffPaneProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);

	return (
		<Box
			flex="1"
			overflow="auto"
			css={{
				"--diffs-font-family": `"${fontFamily}", monospace`,
				"--diffs-font-size": `${fontSize}px`,
			}}
		>
			{activeFile ? (
				<>
					<FileDiffHeader file={activeFile} />
					<FileDiff fileDiff={activeFile} options={options} />
				</>
			) : (
				<Flex align="center" justify="center" h="full" p="8">
					<Text color="fg.muted" fontSize="sm">
						{emptyMessage}
					</Text>
				</Flex>
			)}
		</Box>
	);
}
