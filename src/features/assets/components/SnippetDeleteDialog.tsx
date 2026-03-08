import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useDeleteSnippet } from "@/features/assets/hooks/useSnippets";

interface SnippetDeleteDialogProps {
	deleteTarget: string | null;
	onClose: () => void;
}

export function SnippetDeleteDialog({
	deleteTarget,
	onClose,
}: SnippetDeleteDialogProps) {
	const deleteMutation = useDeleteSnippet();

	const handleDelete = () => {
		if (deleteTarget) {
			deleteMutation.mutate(deleteTarget);
		}
		onClose();
	};

	return (
		<Dialog.Root
			lazyMount
			open={deleteTarget !== null}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.deleteSnippet()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.confirmDeleteSnippet()}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button colorPalette="red" onClick={handleDelete}>
								{m.delete()}
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
