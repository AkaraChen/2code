import {
	Badge,
	Box,
	Button,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	IconButton,
	Portal,
	Text,
	Textarea,
} from "@chakra-ui/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { memo, useCallback, useMemo } from "react";
import type { ChangeEvent } from "react";
import { FiCopy, FiTrash2 } from "react-icons/fi";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { toaster } from "@/shared/providers/appToaster";
import { SECONDARY_BUTTON_VARIANT } from "@/theme/buttonVariants";
import {
	type DiffReviewComment,
	formatReviewCommentsForAgent,
	formatReviewRange,
} from "../reviewQueue";

interface GitReviewQueueDialogProps {
	isOpen: boolean;
	comments: DiffReviewComment[];
	options: FileDiffOptions<unknown>;
	onClose: () => void;
	onClear: () => void;
	onDelete: (id: string) => void;
	onUpdate: (id: string, body: string) => void;
}

interface ReviewQueueCommentCardProps {
	comment: DiffReviewComment;
	fontFamily: string;
	fontSize: number;
	options: FileDiffOptions<unknown>;
	onDelete: (id: string) => void;
	onUpdate: (id: string, body: string) => void;
}

const ReviewQueueCommentCard = memo(({
	comment,
	fontFamily,
	fontSize,
	options,
	onDelete,
	onUpdate,
}: ReviewQueueCommentCardProps) => {
	const diffCss = useMemo(
		() => ({
			"--diffs-font-family": `"${fontFamily}", monospace`,
			"--diffs-font-size": `${fontSize}px`,
		}),
		[fontFamily, fontSize],
	);
	const handleDelete = useCallback(() => {
		onDelete(comment.id);
	}, [comment.id, onDelete]);
	const handleBodyChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			onUpdate(comment.id, event.target.value);
		},
		[comment.id, onUpdate],
	);

	return (
		<Box
			borderWidth="1px"
			borderColor="border.subtle"
			borderRadius="md"
			overflow="hidden"
		>
			<HStack
				align="start"
				gap="3"
				px="3"
				py="2.5"
				bg="bg.subtle"
				borderBottomWidth="1px"
				borderColor="border.subtle"
			>
				<Box flex="1" minW="0">
					<Text
						fontSize="sm"
						fontFamily="mono"
						fontWeight="semibold"
						truncate
					>
						{comment.displayName}
					</Text>
					<HStack mt="1" gap="2">
						<Badge
							size="xs"
							variant="subtle"
							colorPalette="blue"
							fontFamily="mono"
						>
							{formatReviewRange(comment.range)}
						</Badge>
						<Text fontSize="xs" color="fg.muted">
							Selected diff
						</Text>
					</HStack>
				</Box>
				<IconButton
					aria-label="Delete review comment"
					size="xs"
					variant="ghost"
					colorPalette="red"
					flexShrink={0}
					onClick={handleDelete}
				>
					<FiTrash2 />
				</IconButton>
			</HStack>
			<Box
				mx="3"
				mt="3"
				maxH="8rem"
				overflow="auto"
				borderWidth="1px"
				borderColor="border.subtle"
				borderRadius="md"
				css={diffCss}
			>
				<FileDiff
					fileDiff={comment.fileDiff}
					options={options}
					selectedLines={comment.range}
					disableWorkerPool
				/>
			</Box>
			<Text
				px="3"
				pt="3"
				fontSize="xs"
				fontWeight="semibold"
				color="fg.muted"
			>
				Comment
			</Text>
			<Textarea
				mx="3"
				mt="1.5"
				mb="3"
				w="calc(100% - 1.5rem)"
				value={comment.body}
				autoresize
				minH="5rem"
				onChange={handleBodyChange}
			/>
		</Box>
	);
});

export default function GitReviewQueueDialog({
	isOpen,
	comments,
	options,
	onClose,
	onClear,
	onDelete,
	onUpdate,
}: GitReviewQueueDialogProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const reviewDiffOptions = useMemo<FileDiffOptions<unknown>>(
		() => ({
			...options,
			disableFileHeader: true,
			enableGutterUtility: false,
			enableLineSelection: false,
		}),
		[options],
	);

	const handleCopyAll = useCallback(async () => {
		await copyTextToClipboard(formatReviewCommentsForAgent(comments));
		toaster.create({
			title: "Review comments copied",
			type: "success",
			closable: true,
		});
	}, [comments]);

	const handleCopyAndClearAll = useCallback(async () => {
		await copyTextToClipboard(formatReviewCommentsForAgent(comments));
		onClear();
		onClose();
		toaster.create({
			title: "Review comments copied and cleared",
			type: "success",
			closable: true,
		});
	}, [comments, onClear, onClose]);
	const handleOpenChange = useCallback(
		(event: { open: boolean }) => {
			if (!event.open) onClose();
		},
		[onClose],
	);

	return (
		<Dialog.Root
			open={isOpen}
			size="xl"
			onOpenChange={handleOpenChange}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content maxH="80vh">
						<Dialog.Header>
							<Dialog.Title>Review Queue</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>
						<Dialog.Body overflow="auto">
							<Flex direction="column" gap="3">
								{comments.map((comment) => (
									<ReviewQueueCommentCard
										key={comment.id}
										comment={comment}
										fontFamily={fontFamily}
										fontSize={fontSize}
										options={reviewDiffOptions}
										onDelete={onDelete}
										onUpdate={onUpdate}
									/>
								))}
							</Flex>
						</Dialog.Body>
						<Dialog.Footer gap="2">
							<Button
								variant={SECONDARY_BUTTON_VARIANT}
								onClick={handleCopyAll}
								disabled={comments.length === 0}
							>
								<FiCopy />
								Copy
							</Button>
							<Button
								variant="solid"
								colorPalette="red"
								onClick={handleCopyAndClearAll}
								disabled={comments.length === 0}
							>
								<FiCopy />
								Copy and clear all
							</Button>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
