import {
	Button,
	CloseButton,
	Dialog,
	Field,
	Flex,
	Portal,
	Text,
	Textarea,
} from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

interface GitDiffCommentDialogProps {
	isOpen: boolean;
	onClose: () => void;
	location: string;
	comment: string;
	onCommentChange: (value: string) => void;
	onConfirm: () => void;
}

export default function GitDiffCommentDialog({
	isOpen,
	onClose,
	location,
	comment,
	onCommentChange,
	onConfirm,
}: GitDiffCommentDialogProps) {
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
							<Dialog.Title>{m.gitDiffCommentDialogTitle()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Flex direction="column" gap="4">
								<Field.Root>
									<Field.Label>
										{m.gitDiffCommentDialogSelectionLabel()}
									</Field.Label>
									<Text fontSize="sm" fontFamily="mono" color="fg.muted">
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
										onChange={(event) => onCommentChange(event.target.value)}
										onKeyDown={(event) => {
											if (
												(event.metaKey || event.ctrlKey) &&
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
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button onClick={onConfirm} disabled={trimmedComment.length === 0}>
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
