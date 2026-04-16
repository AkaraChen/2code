import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";

interface TerminalLinkConfirmDialogProps {
	link: string | null;
	onClose: () => void;
	onOpen: () => void;
}

export function TerminalLinkConfirmDialog({
	link,
	onClose,
	onOpen,
}: TerminalLinkConfirmDialogProps) {
	return (
		<Dialog.Root
			lazyMount
			open={!!link}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>{m.terminalOpenLink()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.terminalOpenLinkConfirmDescription()}</Text>
							<Text mt="4" fontSize="sm" color="fg.muted" fontFamily="mono">
								{m.terminalOpenLinkUrlLabel()}
							</Text>
							<Text mt="1" fontSize="sm" fontFamily="mono" wordBreak="break-all">
								{link}
							</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button onClick={onOpen}>{m.terminalOpenLink()}</Button>
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
