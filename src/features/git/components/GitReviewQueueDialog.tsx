import {
	Box,
	Button,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Portal,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { FileDiff } from "@pierre/diffs/react";
import { FiCopy, FiTrash2 } from "react-icons/fi";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { toaster } from "@/shared/providers/appToaster";
import {
	type DiffReviewComment,
	formatReviewCommentsForAgent,
	formatReviewRange,
} from "../reviewQueue";

interface GitReviewQueueDialogProps {
	isOpen: boolean;
	comments: DiffReviewComment[];
	onClose: () => void;
	onDelete: (id: string) => void;
	onUpdate: (id: string, body: string) => void;
}

export default function GitReviewQueueDialog({
	isOpen,
	comments,
	onClose,
	onDelete,
	onUpdate,
}: GitReviewQueueDialogProps) {
	async function handleCopyAll() {
		await copyTextToClipboard(formatReviewCommentsForAgent(comments));
		toaster.create({
			title: "Review comments copied",
			type: "success",
			closable: true,
		});
	}

	return (
		<Dialog.Root
			open={isOpen}
			size="xl"
			onOpenChange={(event) => {
				if (!event.open) onClose();
			}}
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
									<Box
										key={comment.id}
										borderWidth="1px"
										borderColor="border.subtle"
										borderRadius="md"
										p="3"
									>
										<HStack align="start" gap="3">
											<Box flex="1" minW="0">
												<Text
													fontSize="sm"
													fontFamily="mono"
													fontWeight="semibold"
													truncate
												>
													{comment.displayName}
												</Text>
												<Text
													mt="0.5"
													fontSize="xs"
													color="fg.muted"
												>
													{formatReviewRange(
														comment.range,
													)}
												</Text>
											</Box>
											<Button
												size="xs"
												variant="ghost"
												colorPalette="red"
												onClick={() =>
													onDelete(comment.id)
												}
											>
												<FiTrash2 />
											</Button>
										</HStack>
										<Box
											mt="2"
											maxH="8rem"
											overflow="auto"
											borderWidth="1px"
											borderColor="border.subtle"
											borderRadius="md"
										>
											<FileDiff
												fileDiff={comment.fileDiff}
												options={{
													disableFileHeader: true,
													hunkSeparators: "line-info-basic",
												}}
												selectedLines={comment.range}
												disableWorkerPool
											/>
										</Box>
										<Textarea
											mt="2"
											value={comment.body}
											autoresize
											minH="5rem"
											onChange={(event) =>
												onUpdate(
													comment.id,
													event.target.value,
												)
											}
										/>
									</Box>
								))}
							</Flex>
						</Dialog.Body>
						<Dialog.Footer>
							<Button
								variant="outline"
								onClick={handleCopyAll}
								disabled={comments.length === 0}
							>
								<FiCopy />
								Copy all
							</Button>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
