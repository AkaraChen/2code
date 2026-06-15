import {
	autoUpdate,
	computePosition,
	flip,
	offset,
	shift,
	size,
} from "@floating-ui/dom";
import type { ReferenceElement, VirtualElement } from "@floating-ui/dom";
import {
	Badge,
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Textarea,
	Text,
} from "@chakra-ui/react";
import type {
	FileDiffMetadata,
	FileDiffOptions,
	SelectedLineRange,
} from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiX } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	changeBadge,
	GIT_DIFF_LARGE_FILE_LINE_THRESHOLD,
	getLineStats,
	isBinaryImageDiffPreviewable,
} from "../utils";
import {
	createReviewComment,
	type DiffReviewComment,
	formatReviewRange,
} from "../reviewQueue";
import { BinaryImageDiffPreview, type GitPreviewContext } from "./GitBinaryPreview";

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

function getElementsVirtualReference(
	elements: HTMLElement[],
): VirtualElement | null {
	if (elements.length === 0) return null;

	return {
		contextElement: elements[0],
		getBoundingClientRect: () => {
			const rects = elements
				.map((element) => element.getBoundingClientRect())
				.filter((rect) => rect.width > 0 || rect.height > 0);

			if (rects.length === 0) {
				const fallbackRect = elements[0].getBoundingClientRect();
				return fallbackRect;
			}

			const left = Math.min(...rects.map((rect) => rect.left));
			const top = Math.min(...rects.map((rect) => rect.top));
			const right = Math.max(...rects.map((rect) => rect.right));
			const bottom = Math.max(...rects.map((rect) => rect.bottom));

			return {
				x: left,
				y: top,
				left,
				top,
				right,
				bottom,
				width: right - left,
				height: bottom - top,
				toJSON() {
					return this;
				},
			};
		},
	};
}

function queryDiffElements(root: ParentNode, selector: string): HTMLElement[] {
	const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
	for (const host of root.querySelectorAll<HTMLElement>("*")) {
		if (host.shadowRoot) {
			elements.push(...queryDiffElements(host.shadowRoot, selector));
		}
	}
	return elements;
}

function ActiveGitDiffFilePane({
	activeFile,
	options,
	previewContext,
	isLargeDiffExpanded,
	onRevealLargeDiff,
	onAddReviewComment,
}: {
	activeFile: FileDiffMetadata;
	options: FileDiffOptions<unknown>;
	previewContext?: GitPreviewContext;
	isLargeDiffExpanded: boolean;
	onRevealLargeDiff: () => void;
	onAddReviewComment?: (comment: DiffReviewComment) => void;
}) {
	const [selectedLines, setSelectedLines] =
		useState<SelectedLineRange | null>(null);
	const [commentBody, setCommentBody] = useState("");
	const [isCommentInputOpen, setIsCommentInputOpen] = useState(false);
	const [commentAnchor, setCommentAnchor] = useState<ReferenceElement | null>(
		null,
	);
	const diffContentRef = useRef<HTMLDivElement>(null);
	const commentComposerRef = useRef<HTMLDivElement>(null);
	const pendingSelectionRef = useRef<SelectedLineRange | null>(null);
	const { additions, deletions } = useMemo(
		() => getLineStats(activeFile),
		[activeFile],
	);
	const changedLineCount = additions + deletions;
	const showBinaryPreview =
		previewContext != null && isBinaryImageDiffPreviewable(activeFile);
	const showLargeDiffGuardrail =
		!showBinaryPreview &&
		changedLineCount >= GIT_DIFF_LARGE_FILE_LINE_THRESHOLD &&
		!isLargeDiffExpanded;
	const showRenameOnlyDiff = activeFile.type === "rename-pure";
	const canReviewDiff =
		onAddReviewComment != null &&
		!showBinaryPreview &&
		!showLargeDiffGuardrail &&
		!showRenameOnlyDiff;
	const getCommentAnchor = useCallback(
		(range: SelectedLineRange, lineElement?: HTMLElement) => {
			const diffContent = diffContentRef.current;
			if (lineElement) return lineElement;
			if (!diffContent) return null;

			const selectedElements = queryDiffElements(
				diffContent,
				"[data-selected-line]",
			);
			const selectedReference =
				getElementsVirtualReference(selectedElements);
			if (selectedReference) return selectedReference;

			const start = Math.min(range.start, range.end);
			const end = Math.max(range.start, range.end);
			const fallbackElements = queryDiffElements(
				diffContent,
				[
					`[data-column-number="${start}"]`,
					`[data-column-number="${end}"]`,
					`[data-line="${start}"]`,
					`[data-line="${end}"]`,
				].join(", "),
			);

			return (
				getElementsVirtualReference(fallbackElements) ??
				queryDiffElements(
					diffContent,
					`[data-line-index="${start}"], [data-line-index="${end}"]`,
				)[0] ??
				null
			);
		},
		[],
	);
	const updateFloatingComposer = useCallback(() => {
		const anchorElement = commentAnchor;
		const composerElement = commentComposerRef.current;
		if (!anchorElement || !composerElement) return;

		void computePosition(anchorElement, composerElement, {
			placement: "right-start",
			strategy: "fixed",
			middleware: [
				offset(12),
				flip({
					fallbackPlacements: ["left-start", "bottom-start", "top-start"],
				}),
				shift({ padding: 12 }),
				size({
					padding: 12,
					apply({ availableWidth, elements }) {
						Object.assign(elements.floating.style, {
							maxWidth: `${Math.min(448, availableWidth)}px`,
						});
					},
				}),
			],
		}).then(({ x, y }) => {
			if (commentComposerRef.current !== composerElement) return;

			Object.assign(composerElement.style, {
				left: `${x}px`,
				top: `${y}px`,
			});
		});
	}, [commentAnchor]);
	const openCommentComposer = useCallback(
		(range: SelectedLineRange, lineElement?: HTMLElement) => {
			setSelectedLines(range);
			setCommentAnchor(getCommentAnchor(range, lineElement));
			setIsCommentInputOpen(true);
		},
		[getCommentAnchor],
	);
	const syncCommentAnchorFromSelection = useCallback(
		(range: SelectedLineRange | null) => {
			setCommentAnchor(range ? getCommentAnchor(range) : null);
			if (!range) return;

			requestAnimationFrame(() => {
				setCommentAnchor(getCommentAnchor(range));
			});
		},
		[getCommentAnchor],
	);
	const openCommentComposerFromSelection = useCallback(
		(range: SelectedLineRange | null) => {
			pendingSelectionRef.current = null;
			setSelectedLines(range);
			syncCommentAnchorFromSelection(range);
			setIsCommentInputOpen(range != null);
		},
		[syncCommentAnchorFromSelection],
	);
	const syncPendingSelection = useCallback(
		(range: SelectedLineRange | null) => {
			pendingSelectionRef.current = range;
			setSelectedLines(range);
			syncCommentAnchorFromSelection(range);
		},
		[syncCommentAnchorFromSelection],
	);
	const openCommentComposerOnSelectionCommit = useCallback(
		(range: SelectedLineRange | null) => {
			openCommentComposerFromSelection(range ?? pendingSelectionRef.current);
		},
		[openCommentComposerFromSelection],
	);
	useEffect(() => {
		const anchorElement = commentAnchor;
		const composerElement = commentComposerRef.current;
		if (!isCommentInputOpen || !anchorElement || !composerElement) return;

		return autoUpdate(anchorElement, composerElement, updateFloatingComposer, {
			animationFrame: true,
		});
	}, [commentAnchor, isCommentInputOpen, updateFloatingComposer]);
	const interactiveOptions = useMemo<FileDiffOptions<unknown>>(
		() => ({
			...options,
			enableLineSelection: canReviewDiff,
			enableGutterUtility: false,
			lineHoverHighlight: canReviewDiff ? "both" : options.lineHoverHighlight,
			onLineNumberClick: (lineEvent) => {
				if (canReviewDiff) {
					openCommentComposer({
						start: lineEvent.lineNumber,
						end: lineEvent.lineNumber,
						side: lineEvent.annotationSide,
					}, lineEvent.lineElement);
				}
				options.onLineNumberClick?.(lineEvent);
			},
			onLineSelectionStart: (range) => {
				syncPendingSelection(range);
				options.onLineSelectionStart?.(range);
			},
			onLineSelectionChange: (range) => {
				syncPendingSelection(range);
				options.onLineSelectionChange?.(range);
			},
			onLineSelectionEnd: (range) => {
				openCommentComposerOnSelectionCommit(range);
				options.onLineSelectionEnd?.(range);
			},
			onLineSelected: (range) => {
				openCommentComposerOnSelectionCommit(range);
				options.onLineSelected?.(range);
			},
		}),
		[
			canReviewDiff,
			openCommentComposer,
			openCommentComposerOnSelectionCommit,
			options,
			syncPendingSelection,
		],
	);
	const handleAddReviewComment = useCallback(() => {
		if (!selectedLines || !commentBody.trim() || !onAddReviewComment) return;

		onAddReviewComment(
			createReviewComment(activeFile, selectedLines, commentBody.trim()),
		);
		setCommentBody("");
		setIsCommentInputOpen(false);
		setSelectedLines(null);
	}, [activeFile, commentBody, onAddReviewComment, selectedLines]);

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
				<Box ref={diffContentRef} position="relative">
					<FileDiff
						fileDiff={activeFile}
						options={interactiveOptions}
						selectedLines={selectedLines}
					/>
					{canReviewDiff && selectedLines && isCommentInputOpen && (
						<Box
							ref={commentComposerRef}
							position="fixed"
							zIndex={2}
							pointerEvents="none"
						>
							<Box
								w="min(28rem, calc(100vw - 2rem))"
								borderWidth="1px"
								borderColor="border.emphasized"
								borderRadius="lg"
								bg="bg.panel"
								boxShadow="xl"
								overflow="hidden"
								pointerEvents="auto"
							>
								<HStack
									px="3"
									py="2"
									borderBottomWidth="1px"
									borderColor="border.subtle"
									justify="space-between"
									gap="3"
								>
									<Text
										fontSize="xs"
										fontWeight="semibold"
										color="fg.muted"
										truncate
									>
										Comment on{" "}
										{formatReviewRange(selectedLines)}
									</Text>
									<IconButton
										aria-label="Cancel review comment"
										size="2xs"
										variant="ghost"
										onClick={() => {
											setCommentBody("");
											setIsCommentInputOpen(false);
											setSelectedLines(null);
										}}
									>
										<FiX />
									</IconButton>
								</HStack>
								<Textarea
									value={commentBody}
									placeholder="Write a review comment..."
									autoresize
									minH="5.5rem"
									maxH="10rem"
									fontSize="sm"
									borderWidth="0"
									borderRadius="0"
									resize="none"
									_focusVisible={{
										outline: "none",
										boxShadow: "none",
									}}
									onChange={(event) =>
										setCommentBody(event.target.value)
									}
								/>
								<Flex
									px="3"
									py="2"
									borderTopWidth="1px"
									borderColor="border.subtle"
									bg="bg.subtle"
									justify="flex-end"
								>
									<Button
										size="xs"
										variant="solid"
										disabled={!commentBody.trim()}
										onClick={handleAddReviewComment}
									>
										<FiPlus />
										Add to queue
									</Button>
								</Flex>
							</Box>
						</Box>
					)}
				</Box>
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
	onAddReviewComment?: (comment: DiffReviewComment) => void;
}

export default function GitDiffPane({
	activeFile,
	options,
	emptyMessage,
	contextKey = "default",
	previewContext,
	onAddReviewComment,
}: GitDiffPaneProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const [expandedLargeDiffFileKeys, setExpandedLargeDiffFileKeys] = useState<
		Set<string>
	>(() => new Set());

	const activeFileKey = activeFile
		? getGitDiffPaneFileKey(activeFile, contextKey)
		: null;
	const diffCss = useMemo(
		() => ({
			"--diffs-font-family": `"${fontFamily}", monospace`,
			"--diffs-font-size": `${fontSize}px`,
		}),
		[fontFamily, fontSize],
	);
	const handleRevealLargeDiff = useCallback(() => {
		if (!activeFileKey) return;

		setExpandedLargeDiffFileKeys((prev) => {
			const next = new Set(prev);
			next.add(activeFileKey);
			return next;
		});
	}, [activeFileKey]);

	return (
		<Box
			flex="1"
			overflow="auto"
			css={diffCss}
		>
			{activeFile && activeFileKey ? (
				<ActiveGitDiffFilePane
					key={activeFileKey}
					activeFile={activeFile}
					options={options}
					previewContext={previewContext}
					isLargeDiffExpanded={expandedLargeDiffFileKeys.has(activeFileKey)}
					onAddReviewComment={onAddReviewComment}
					onRevealLargeDiff={handleRevealLargeDiff}
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
