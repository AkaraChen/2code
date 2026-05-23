import { Button, CloseButton, Dialog, Flex, Portal, Text } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";

interface TerminalLinkConfirmDialogProps {
	link: string | null;
	onClose: () => void;
	onOpen: () => void;
	onOpenInApp?: () => void;
	onOpenInBrowser?: (browserId: string) => void;
}

export function TerminalLinkConfirmDialog({
	link,
	onClose,
	onOpen,
	onOpenInApp,
	onOpenInBrowser,
}: TerminalLinkConfirmDialogProps) {
	const { data: browsers } = useQuery({
		...queryKeys.browsers.installed,
		enabled: !!link,
	});

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
							<Flex gap="2" wrap="wrap" justify="flex-end" w="full">
								<Dialog.ActionTrigger asChild>
									<Button variant="outline">{m.cancel()}</Button>
								</Dialog.ActionTrigger>
								{onOpenInApp && (
									<Button variant="outline" onClick={onOpenInApp}>
										{m.browserOpenInApp()}
									</Button>
								)}
								{browsers && browsers.length > 0 && onOpenInBrowser && (
									browsers.map((browser) => (
										<Button
											key={browser.id}
											variant="outline"
											onClick={() => onOpenInBrowser(browser.id)}
										>
											{browser.name}
										</Button>
									))
								)}
								<Button onClick={onOpen}>{m.browserOpenDefault()}</Button>
							</Flex>
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
