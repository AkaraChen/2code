import {
	Badge,
	Box,
	Button,
	CloseButton,
	Dialog,
	Field,
	Flex,
	HStack,
	Portal,
	Spinner,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
import { toaster } from "@/shared/providers/Toaster";
import { useGitBinaryPreview } from "../hooks";
import {
	formatGitDiffCommentLocation,
	formatGitDiffCommentPayload,
	formatSelectedLineRange,
	getGitDiffCommentAnchor,
	getGitDiffCommentFileKey,
	normalizeSelectedLineRange,
} from "../commentUtils";
import {
	changeBadge,
	type GitBinaryPreviewSource,
	getGitBinaryPreviewPath,
	getGitBinaryPreviewRevision,
	getLineStats,
	getPreviewableImageMimeType,
	gitBinaryPreviewSources,
	isBinaryImageDiffPreviewable,
} from "../utils";

interface GitPreviewContextWorkingTree {
	kind: "working-tree";
	profileId: string;
}

interface GitPreviewContextCommit {
	kind: "commit";
	profileId: string;
	commitHash: string;
}

type GitPreviewContext =
	| GitPreviewContextWorkingTree
	| GitPreviewContextCommit;

interface GitDiffCommentAnnotation {
	id: string;
	comment: string;
	location: string;
	selection: SelectedLineRange;
}

async function copyTextToClipboard(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "absolute";
	textarea.style.opacity = "0";
	document.body.append(textarea);
	textarea.select();

	const copied = document.execCommand("copy");
	textarea.remove();

	if (!copied) {
		throw new Error("Clipboard copy failed");
	}
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

function GitDiffCommentDialog({
	isOpen,
	onClose,
	location,
	comment,
	onCommentChange,
	onConfirm,
}: {
	isOpen: boolean;
	onClose: () => void;
	location: string;
	comment: string;
	onCommentChange: (value: string) => void;
	onConfirm: () => void;
}) {
	const trimmedComment = comment.trim();

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(event) => {
				if (!event.open) {
					onClose();
				}
			}}
			initialFocusEl={() =>
				document.querySelector<HTMLTextAreaElement>(
					"[data-git-diff-comment-input]",
				)
			}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{m.gitDiffCommentDialogTitle()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Flex direction="column" gap="4">
								<Field.Root>
									<Field.Label>
										{m.gitDiffCommentDialogSelectionLabel()}
									</Field.Label>
									<Text
										fontSize="sm"
										fontFamily="mono"
										color="fg.muted"
									>
										{location}
									</Text>
								</Field.Root>

								<Field.Root required>
									<Field.Label>
										{m.gitDiffCommentDialogFieldLabel()}
									</Field.Label>
									<Textarea
										data-git-diff-comment-input
										rows={5}
										value={comment}
										placeholder={m.gitDiffCommentDialogPlaceholder()}
										onChange={(event) =>
											onCommentChange(
												event.target.value,
											)
										}
										onKeyDown={(event) => {
											if (
												(event.metaKey ||
													event.ctrlKey) &&
												event.key === "Enter" &&
												trimmedComment.length > 0
											) {
												event.preventDefault();
												onConfirm();
											}
										}}
									/>
								</Field.Root>
							</Flex>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">
									{m.cancel()}
								</Button>
							</Dialog.ActionTrigger>
							<Button
								onClick={onConfirm}
								disabled={trimmedComment.length === 0}
							>
								{m.gitDiffCommentDialogConfirm()}
							</Button>
						</Dialog.Footer>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
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
		if (selectedLines == null) {
			return;
		}

		const trimmedComment = commentDraft.trim();
		if (trimmedComment.length === 0) {
			return;
		}

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
				formatGitDiffCommentPayload(
					activeFile,
					selectedLines,
					trimmedComment,
				),
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
				description:
					error instanceof Error ? error.message : String(error),
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
				<BinaryImageDiffPreview
					file={activeFile}
					previewContext={previewContext}
				/>
			) : (
				<FileDiff
					fileDiff={activeFile}
					options={diffOptions}
					selectedLines={selectedLines}
					lineAnnotations={lineAnnotations}
					renderAnnotation={(annotation) =>
						annotation.metadata ? (
							<CommentAnnotation
								annotation={annotation.metadata}
							/>
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

function useBinaryPreviewUrl({
	profileId,
	path,
	source,
	commitHash,
	revision,
	mimeType,
}: {
	profileId: string;
	path: string | null;
	source: GitBinaryPreviewSource;
	commitHash?: string;
	revision: string | null;
	mimeType: string | null;
}) {
	const previewQuery = useGitBinaryPreview(
		path && mimeType && revision
			? {
					profileId,
					path,
					source,
					commitHash,
					revision,
				}
			: null,
	);

	const assetUrl = useMemo(() => {
		if (!previewQuery.data?.file_path || revision == null) {
			return null;
		}

		const baseUrl =
			typeof window !== "undefined" &&
			"__TAURI_INTERNALS__" in window
				? convertFileSrc(previewQuery.data.file_path)
				: previewQuery.data.file_path;
		const separator = baseUrl.includes("?") ? "&" : "?";

		return `${baseUrl}${separator}v=${encodeURIComponent(revision)}`;
	}, [previewQuery.data, revision]);

	return {
		...previewQuery,
		assetUrl,
	};
}

function BinaryPreviewPane({
	label,
	path,
	assetUrl,
	isLoading,
}: {
	label: string;
	path: string;
	assetUrl: string | null;
	isLoading: boolean;
}) {
	return (
		<Flex
			flex="1"
			minH={{ base: "18rem", lg: "24rem" }}
			direction="column"
			borderWidth="1px"
			borderColor="border.subtle"
			borderRadius="lg"
			overflow="hidden"
			bg="bg.panel"
		>
			<Flex
				align="center"
				justify="space-between"
				gap="3"
				px="3"
				py="2.5"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				bg="bg.subtle"
			>
				<Text
					fontSize="xs"
					fontWeight="semibold"
					letterSpacing="widest"
					textTransform="uppercase"
					color="fg.muted"
				>
					{label}
				</Text>
				<Text
					fontSize="xs"
					fontFamily="mono"
					color="fg.muted"
					truncate
				>
					{path}
				</Text>
			</Flex>

			<Flex
				flex="1"
				align="center"
				justify="center"
				p="4"
				minH="0"
				bgImage={[
					"linear-gradient(45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(-45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
					"linear-gradient(45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
					"linear-gradient(-45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
				].join(", ")}
				bgSize="16px 16px"
				css={{ backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0" }}
			>
				{isLoading ? (
					<Spinner size="sm" color="colorPalette.500" />
				) : assetUrl ? (
					<img
						src={assetUrl}
						alt={path}
						style={{
							maxWidth: "100%",
							maxHeight: "70vh",
							objectFit: "contain",
							borderRadius: "0.375rem",
							boxShadow:
								"var(--chakra-shadows-md, 0 4px 6px rgba(0, 0, 0, 0.1))",
						}}
					/>
				) : (
					<Text fontSize="sm" color="fg.muted">
						{m.gitDiffImagePreviewUnavailable()}
					</Text>
				)}
			</Flex>
		</Flex>
	);
}

function BinaryImageDiffPreview({
	file,
	previewContext,
}: {
	file: FileDiffMetadata;
	previewContext: GitPreviewContext;
}) {
	const beforePath = getGitBinaryPreviewPath(file, "before");
	const afterPath = getGitBinaryPreviewPath(file, "after");
	const beforeMimeType =
		beforePath == null ? null : getPreviewableImageMimeType(beforePath);
	const afterMimeType =
		afterPath == null ? null : getPreviewableImageMimeType(afterPath);
	const beforeRevision =
		beforePath == null ? null : getGitBinaryPreviewRevision(file, "before");
	const afterRevision =
		afterPath == null ? null : getGitBinaryPreviewRevision(file, "after");

	const beforePreview = useBinaryPreviewUrl({
		profileId: previewContext.profileId,
		path: beforePath,
		source:
			previewContext.kind === "working-tree"
				? gitBinaryPreviewSources.head
				: gitBinaryPreviewSources.parentCommit,
		commitHash:
			previewContext.kind === "commit"
				? previewContext.commitHash
				: undefined,
		revision: beforeRevision,
		mimeType: beforeMimeType,
	});
	const afterPreview = useBinaryPreviewUrl({
		profileId: previewContext.profileId,
		path: afterPath,
		source:
			previewContext.kind === "working-tree"
				? gitBinaryPreviewSources.workingTree
				: gitBinaryPreviewSources.commit,
		commitHash:
			previewContext.kind === "commit"
				? previewContext.commitHash
				: undefined,
		revision: afterRevision,
		mimeType: afterMimeType,
	});

	return (
		<Flex
			flex="1"
			minH="0"
			direction={{ base: "column", xl: "row" }}
			gap="4"
			p="4"
			overflow="auto"
		>
			{beforePath && beforeMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewBefore()}
					path={beforePath}
					assetUrl={beforePreview.assetUrl}
					isLoading={beforePreview.isLoading}
				/>
			) : null}

			{afterPath && afterMimeType ? (
				<BinaryPreviewPane
					label={m.gitDiffImagePreviewAfter()}
					path={afterPath}
					assetUrl={afterPreview.assetUrl}
					isLoading={afterPreview.isLoading}
				/>
			) : null}
		</Flex>
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
		activeFileKey == null
			? null
			: selectedLinesByFileKey[activeFileKey] ?? null;
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
