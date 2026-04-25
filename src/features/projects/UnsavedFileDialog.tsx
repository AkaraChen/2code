import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useState } from "react";
import * as m from "@/paraglide/messages.js";

export type UnsavedFileChoice = "save" | "discard" | "cancel";

interface UnsavedFileDialogProps {
	isOpen: boolean;
	fileName: string;
	isUntitled: boolean;
	onClose: (choice: UnsavedFileChoice) => void;
}

export default function UnsavedFileDialog({
	isOpen,
	fileName,
	isUntitled,
	onClose,
}: UnsavedFileDialogProps) {
	const [pendingChoice, setPendingChoice] = useState<UnsavedFileChoice | null>(
		null,
	);

	const close = (choice: UnsavedFileChoice) => {
		if (pendingChoice) return;
		setPendingChoice(choice);
		onClose(choice);
		// Reset so the dialog can reopen for another tab.
		setTimeout(() => setPendingChoice(null), 0);
	};

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) close("cancel");
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{m.unsavedFileDialogTitle({ name: fileName })}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.unsavedFileDialogBody()}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Button variant="outline" onClick={() => close("cancel")}>
								{m.cancel()}
							</Button>
							<Button
								variant="ghost"
								colorPalette="red"
								onClick={() => close("discard")}
							>
								{m.unsavedFileDialogDiscard()}
							</Button>
							<Button onClick={() => close("save")}>
								{isUntitled
									? m.unsavedFileDialogSaveAs()
									: m.unsavedFileDialogSave()}
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
