import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useState } from "react";
import * as m from "@/paraglide/messages.js";

interface FileTreeDeleteDialogProps {
	isOpen: boolean;
	targetPath: string | null;
	isFolder: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void> | void;
}

function getDisplayName(path: string) {
	const trimmed = path.replace(/[\\/]+$/, "");
	const parts = trimmed.split("/");
	return parts[parts.length - 1] || trimmed;
}

export default function FileTreeDeleteDialog({
	isOpen,
	targetPath,
	isFolder,
	onClose,
	onConfirm,
}: FileTreeDeleteDialogProps) {
	const [isDeleting, setIsDeleting] = useState(false);
	const name = targetPath ? getDisplayName(targetPath) : "";
	const message = isFolder
		? m.fileTreeDeleteFolderConfirm({ name })
		: m.fileTreeDeleteFileConfirm({ name });

	const handleDelete = async () => {
		setIsDeleting(true);
		try {
			await onConfirm();
			onClose();
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.fileTreeDeleteTitle()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{message}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								colorPalette="red"
								disabled={isDeleting}
								onClick={handleDelete}
							>
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
