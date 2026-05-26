import {
	Button,
	CloseButton,
	Dialog,
	HStack,
	IconButton,
	Menu,
	Portal,
	Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { FiChevronDown } from "react-icons/fi";
import { listInstalledBrowsers, openUrlInBrowser } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import * as m from "@/paraglide/messages.js";

interface TerminalLinkConfirmDialogProps {
	link: string | null;
	onClose: () => void;
	onOpenDefault: () => void;
}

export function TerminalLinkConfirmDialog({
	link,
	onClose,
	onOpenDefault,
}: TerminalLinkConfirmDialogProps) {
	const { data: browsers = [] } = useQuery({
		queryKey: queryKeys.browser.installed,
		queryFn: listInstalledBrowsers,
		staleTime: 60_000,
	});

	function openWithBrowser(browserId: string) {
		if (!link) return;
		void openUrlInBrowser({ browserId, url: link });
		onClose();
	}

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
							<HStack gap="0">
								<Button
									variant="outline"
									borderRightRadius="0"
									onClick={onOpenDefault}
								>
									{m.browserOpenDefault()}
								</Button>
								<Menu.Root>
									<Menu.Trigger asChild>
										<IconButton
											variant="outline"
											borderLeftRadius="0"
											ml="-1px"
											aria-label={m.browserOpenWith()}
											disabled={browsers.length === 0}
										>
											<FiChevronDown />
										</IconButton>
									</Menu.Trigger>
									<Portal>
										<Menu.Positioner>
											<Menu.Content minW="52">
												{browsers.map((browser) => (
													<Menu.Item
														key={browser.id}
														value={browser.id}
														onClick={() => openWithBrowser(browser.id)}
													>
														{browser.name}
													</Menu.Item>
												))}
											</Menu.Content>
										</Menu.Positioner>
									</Portal>
								</Menu.Root>
							</HStack>
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
