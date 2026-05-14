import {
	Badge,
	Box,
	Button,
	Flex,
	HStack,
	Text,
} from "@chakra-ui/react";
import type {
	FileDiffMetadata,
	FileDiffOptions,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	changeBadge,
	GIT_DIFF_LARGE_FILE_LINE_THRESHOLD,
	getLineStats,
	isBinaryImageDiffPreviewable,
	isLargeGitDiffFile,
} from "../utils";
import { BinaryImageDiffPreview, type GitPreviewContext } from "./GitBinaryPreview";

export type { GitPreviewContext };

function FileDiffHeader({
	file,
	additions,
	deletions,
}: {
	file: FileDiffMetadata;
	additions: number;
	deletions: number;
}) {
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
			bg="bg.panel"
			roundedTop="md"
		>
			<Badge size="xs" colorPalette={badge.colorPalette} variant="subtle">
				{badge.label}
			</Badge>
			<Text fontSize="sm" fontFamily="mono" flex="1" truncate>
				{displayName}
			</Text>
			<HStack gap="2" fontSize="xs" fontFamily="mono">
				{additions > 0 && <Text color="green.solid">+{additions}</Text>}
				{deletions > 0 && <Text color="red.solid">-{deletions}</Text>}
			</HStack>
		</Flex>
	);
}

function LargeDiffGuardrail({
	changedLineCount,
	onReveal,
}: {
	changedLineCount: number;
	onReveal: () => void;
}) {
	return (
		<Flex align="center" justify="center" h="full" p="8">
			<Box
				data-testid="git-diff-large-guardrail"
				maxW="2xl"
				w="full"
				borderWidth="1px"
				borderColor="border.subtle"
				borderRadius="lg"
				bg="bg.subtle"
				p="6"
			>
				<Text fontSize="sm" fontWeight="semibold">
					{m.gitDiffLargeGuardrailTitle()}
				</Text>
				<Text mt="2" fontSize="sm" color="fg.muted">
					{m.gitDiffLargeGuardrailDescription({
						count: changedLineCount,
						threshold: GIT_DIFF_LARGE_FILE_LINE_THRESHOLD,
					})}
				</Text>
				<Button
					mt="4"
					size="sm"
					onClick={onReveal}
					data-testid="git-diff-large-guardrail-reveal"
				>
					{m.gitDiffLargeGuardrailReveal()}
				</Button>
			</Box>
		</Flex>
	);
}

function RenamePathRow({
	label,
	path,
}: {
	label: string;
	path: string;
}) {
	return (
		<Flex
			gap="4"
			align="baseline"
			py="2"
			borderBottomWidth="1px"
			borderColor="border.subtle"
			_last={{ borderBottomWidth: "0" }}
		>
			<Text
				flexShrink={0}
				w="7rem"
				fontSize="xs"
				color="fg.muted"
				textTransform="uppercase"
			>
				{label}
			</Text>
			<Text
				minW="0"
				fontSize="sm"
				fontFamily="mono"
				overflowWrap="anywhere"
			>
				{path}
			</Text>
		</Flex>
	);
}

function RenameOnlyDiff({ file }: { file: FileDiffMetadata }) {
	const previousPath = file.prevName ?? file.name;

	return (
		<Box data-testid="git-rename-only-diff" p="4">
			<RenamePathRow
				label={m.gitDiffRenamePreviousPath()}
				path={previousPath}
			/>
			<RenamePathRow
				label={m.gitDiffRenameCurrentPath()}
				path={file.name}
			/>
		</Box>
	);
}

function ActiveGitDiffFilePane({
	activeFile,
	options,
	previewContext,
	isLargeDiffExpanded,
	onRevealLargeDiff,
}: {
	activeFile: FileDiffMetadata;
	options: FileDiffOptions<unknown>;
	previewContext?: GitPreviewContext;
	isLargeDiffExpanded: boolean;
	onRevealLargeDiff: () => void;
}) {
	const { additions, deletions } = useMemo(
		() => getLineStats(activeFile),
		[activeFile],
	);
	const changedLineCount = additions + deletions;
	const showBinaryPreview =
		previewContext != null && isBinaryImageDiffPreviewable(activeFile);
	const showLargeDiffGuardrail =
		!showBinaryPreview &&
		isLargeGitDiffFile(activeFile) &&
		!isLargeDiffExpanded;
	const showRenameOnlyDiff = activeFile.type === "rename-pure";

	return (
		<>
			<FileDiffHeader
				file={activeFile}
				additions={additions}
				deletions={deletions}
			/>
			{showBinaryPreview && previewContext ? (
				<BinaryImageDiffPreview file={activeFile} previewContext={previewContext} />
			) : showRenameOnlyDiff ? (
				<RenameOnlyDiff file={activeFile} />
			) : showLargeDiffGuardrail ? (
				<LargeDiffGuardrail
					changedLineCount={changedLineCount}
					onReveal={onRevealLargeDiff}
				/>
			) : (
				<FileDiff
					fileDiff={activeFile}
					options={options}
				/>
			)}
		</>
	);
}

function getGitDiffPaneFileKey(
	file: FileDiffMetadata,
	contextKey: string,
) {
	return [
		contextKey,
		file.prevName ?? "",
		file.name,
		file.type,
	].join("::");
}

interface GitDiffPaneProps {
	activeFile: FileDiffMetadata | null;
	options: FileDiffOptions<unknown>;
	emptyMessage: string;
	contextKey?: string;
	previewContext?: GitPreviewContext;
}

export default function GitDiffPane({
	activeFile,
	options,
	emptyMessage,
	contextKey = "default",
	previewContext,
}: GitDiffPaneProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const [expandedLargeDiffFileKeys, setExpandedLargeDiffFileKeys] = useState<
		Set<string>
	>(() => new Set());

	const activeFileKey = activeFile
		? getGitDiffPaneFileKey(activeFile, contextKey)
		: null;

	return (
		<Box
			flex="1"
			overflow="auto"
			css={{
				"--diffs-font-family": `"${fontFamily}", monospace`,
				"--diffs-font-size": `${fontSize}px`,
			}}
		>
			{activeFile && activeFileKey ? (
				<ActiveGitDiffFilePane
					key={activeFileKey}
					activeFile={activeFile}
					options={options}
					previewContext={previewContext}
					isLargeDiffExpanded={expandedLargeDiffFileKeys.has(activeFileKey)}
					onRevealLargeDiff={() =>
						setExpandedLargeDiffFileKeys((prev) => {
							const next = new Set(prev);
							next.add(activeFileKey);
							return next;
						})
					}
				/>
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
