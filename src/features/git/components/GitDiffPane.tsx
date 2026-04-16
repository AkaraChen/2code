import {
	Badge,
	Box,
	Button,
	Flex,
	HStack,
	Text,
} from "@chakra-ui/react";
import type {
	DiffLineAnnotation,
	FileDiffMetadata,
	FileDiffOptions,
	SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useMemo, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { toaster } from "@/shared/providers/Toaster";
import {
	formatGitDiffCommentLocation,
	formatGitDiffCommentPayload,
	formatSelectedLineRange,
	getGitDiffCommentAnchor,
	getGitDiffCommentFileKey,
	normalizeSelectedLineRange,
} from "../commentUtils";
import { changeBadge, getLineStats, isBinaryImageDiffPreviewable } from "../utils";
import { BinaryImageDiffPreview, type GitPreviewContext } from "./GitBinaryPreview";
import GitDiffCommentDialog from "./GitDiffCommentDialog";

export type { GitPreviewContext };

interface GitDiffCommentAnnotation {
	id: string;
	comment: string;
	location: string;
	selection: SelectedLineRange;
}

function FileDiffHeader({
	file,
	selectedRangeLabel,
	canComment,
	onCommentClick,
}: {
	file: FileDiffMetadata;
	selectedRangeLabel: string | null;
	canComment: boolean;
	onCommentClick: () => void;
}) {
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
				{selectedRangeLabel && (
					<Text color="fg.muted">{selectedRangeLabel}</Text>
				)}
				{additions > 0 && <Text color="green.solid">+{additions}</Text>}
				{deletions > 0 && <Text color="red.solid">-{deletions}</Text>}
				<Button
					size="xs"
					variant="subtle"
					disabled={!canComment}
					onClick={onCommentClick}
				>
					{m.gitDiffCommentButton()}
				</Button>
			</HStack>
		</Flex>
	);
}

function CommentAnnotation({
	annotation,
}: {
	annotation: GitDiffCommentAnnotation;
}) {
	return (
		<Box
			px="3"
			py="2.5"
			bg="bg.subtle"
			borderWidth="1px"
			borderColor="border.subtle"
			borderRadius="md"
			mx="2"
			my="1.5"
		>
			<Flex align="center" justify="space-between" gap="3">
				<Text
					fontSize="xs"
					fontWeight="medium"
					letterSpacing="widest"
					textTransform="uppercase"
					color="fg.muted"
				>
					{m.gitDiffCommentButton()}
				</Text>
				<Text fontSize="xs" color="fg.muted" fontFamily="mono">
					{annotation.location}
				</Text>
			</Flex>
			<Text mt="2" fontSize="sm" whiteSpace="pre-wrap">
				{annotation.comment}
			</Text>
		</Box>
	);
}

function ActiveGitDiffFilePane({
	activeFile,
	activeFileKey,
	options,
	previewContext,
	selectedLines,
	comments,
	onSelectionChange,
	onCommentAdd,
}: {
	activeFile: FileDiffMetadata;
	activeFileKey: string;
	options: FileDiffOptions<unknown>;
	previewContext?: GitPreviewContext;
	selectedLines: SelectedLineRange | null;
	comments: GitDiffCommentAnnotation[];
	onSelectionChange: (range: SelectedLineRange | null) => void;
	onCommentAdd: (comment: GitDiffCommentAnnotation) => void;
}) {
	const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
	const [commentDraft, setCommentDraft] = useState("");
	const selectedRangeLabel =
		selectedLines == null ? null : formatSelectedLineRange(selectedLines);
	const selectedLocation =
		selectedLines == null
			? ""
			: formatGitDiffCommentLocation(activeFile, selectedLines);
	const showBinaryPreview =
		previewContext != null && isBinaryImageDiffPreviewable(activeFile);

	const lineAnnotations = useMemo<
		DiffLineAnnotation<GitDiffCommentAnnotation>[]
	>(
		() =>
			comments.map((comment) => {
				const anchor = getGitDiffCommentAnchor(comment.selection);
				return {
					side: anchor.side,
					lineNumber: anchor.lineNumber,
					metadata: comment,
				};
			}),
		[comments],
	);

	const diffOptions = useMemo(
		() =>
			({
				...(options as FileDiffOptions<GitDiffCommentAnnotation>),
				enableLineSelection: true,
				lineHoverHighlight: "line",
				onLineSelected: (range: SelectedLineRange | null) => {
					if (range == null) {
						setIsCommentDialogOpen(false);
						setCommentDraft("");
						onSelectionChange(null);
						return;
					}
					onSelectionChange(normalizeSelectedLineRange(range));
				},
			}) satisfies FileDiffOptions<GitDiffCommentAnnotation>,
		[onSelectionChange, options],
	);

	const handleCommentConfirm = async () => {
		if (selectedLines == null) return;

		const trimmedComment = commentDraft.trim();
		if (trimmedComment.length === 0) return;

		const nextComment: GitDiffCommentAnnotation = {
			id:
				globalThis.crypto?.randomUUID?.() ??
				`${Date.now()}-${activeFileKey}`,
			comment: trimmedComment,
			location: selectedLocation,
			selection: selectedLines,
		};

		onCommentAdd(nextComment);
		onSelectionChange(null);
		setIsCommentDialogOpen(false);
		setCommentDraft("");

		try {
			await copyTextToClipboard(
				formatGitDiffCommentPayload(activeFile, selectedLines, trimmedComment),
			);
			toaster.create({
				title: m.gitDiffCommentCopiedTitle(),
				description: m.gitDiffCommentCopiedDescription({
					location: selectedLocation,
				}),
				type: "success",
				closable: true,
			});
		} catch (error) {
			toaster.create({
				title: m.gitDiffCommentCopyFailedTitle(),
				description: error instanceof Error ? error.message : String(error),
				type: "error",
				closable: true,
			});
		}
	};

	return (
		<>
			<FileDiffHeader
				file={activeFile}
				selectedRangeLabel={selectedRangeLabel}
				canComment={selectedLines != null}
				onCommentClick={() => {
					setIsCommentDialogOpen(true);
					setCommentDraft("");
				}}
			/>
			{showBinaryPreview && previewContext ? (
				<BinaryImageDiffPreview file={activeFile} previewContext={previewContext} />
			) : (
				<FileDiff
					fileDiff={activeFile}
					options={diffOptions}
					selectedLines={selectedLines}
					lineAnnotations={lineAnnotations}
					renderAnnotation={(annotation) =>
						annotation.metadata ? (
							<CommentAnnotation annotation={annotation.metadata} />
						) : null
					}
				/>
			)}
			<GitDiffCommentDialog
				isOpen={isCommentDialogOpen && selectedLines != null}
				onClose={() => {
					setIsCommentDialogOpen(false);
					setCommentDraft("");
				}}
				location={selectedLocation}
				comment={commentDraft}
				onCommentChange={setCommentDraft}
				onConfirm={handleCommentConfirm}
			/>
		</>
	);
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
	const [selectedLinesByFileKey, setSelectedLinesByFileKey] = useState<
		Record<string, SelectedLineRange | null>
	>({});
	const [annotationsByFileKey, setAnnotationsByFileKey] = useState<
		Record<string, GitDiffCommentAnnotation[]>
	>({});

	const activeFileKey = activeFile
		? getGitDiffCommentFileKey(activeFile, contextKey)
		: null;
	const selectedLines =
		activeFileKey == null ? null : selectedLinesByFileKey[activeFileKey] ?? null;
	const comments =
		activeFileKey == null ? [] : annotationsByFileKey[activeFileKey] ?? [];

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
					activeFileKey={activeFileKey}
					options={options}
					previewContext={previewContext}
					selectedLines={selectedLines}
					comments={comments}
					onSelectionChange={(range) =>
						setSelectedLinesByFileKey((prev) => ({
							...prev,
							[activeFileKey]: range,
						}))
					}
					onCommentAdd={(comment) =>
						setAnnotationsByFileKey((prev) => ({
							...prev,
							[activeFileKey]: [
								...(prev[activeFileKey] ?? []),
								comment,
							],
						}))
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
