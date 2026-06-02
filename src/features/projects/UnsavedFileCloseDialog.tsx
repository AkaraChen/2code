import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

interface UnsavedFileCloseDialogProps {
	fileName: string;
	isOpen: boolean;
	onCancel: () => void;
	onDiscard: () => void;
}

export default function UnsavedFileCloseDialog({
	fileName,
	isOpen,
	onCancel,
	onDiscard,
}: UnsavedFileCloseDialogProps) {
	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onCancel();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.closeUnsavedFileTitle()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.closeUnsavedFileDescription({ file: fileName })}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button colorPalette="red" onClick={onDiscard}>
								{m.discardChanges()}
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
