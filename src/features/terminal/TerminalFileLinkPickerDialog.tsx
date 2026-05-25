import {
	Box,
	CloseButton,
	Dialog,
	Flex,
	Portal,
	Text,
} from "@chakra-ui/react";
import { FiFileText } from "react-icons/fi";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import * as m from "@/paraglide/messages.js";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import { useFileLinkPickerStore } from "./fileLinkPickerStore";

export function TerminalFileLinkPickerDialog() {
	const { isOpen, profileId, candidates, close } = useFileLinkPickerStore();
	const openFile = useFileViewerTabsStore((state) => state.openFile);

	function handleOpen(path: string) {
		if (!profileId) return;
		openFile(profileId, path);
		close();
	}

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(event) => {
				if (!event.open) close();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content maxW="xl">
						<Dialog.Header>
							<Dialog.Title>{m.terminalChooseFilePath()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body pt="0">
							<Text color="fg.muted" fontSize="sm">
								{m.terminalChooseFilePathDescription()}
							</Text>
							<Flex
								mt="4"
								borderWidth="1px"
								borderColor="border.subtle"
								borderRadius="md"
								direction="column"
								maxH="50vh"
								overflowY="auto"
							>
								{candidates.map((candidate) => (
									<Flex
										key={candidate.path}
										as="button"
										align="center"
										gap="3"
										minH="11"
										px="3"
										py="2"
										textAlign="left"
										borderBottomWidth="1px"
										borderColor="border.subtle"
										_last={{ borderBottomWidth: 0 }}
										_hover={{ bg: "bg.subtle" }}
										_focusVisible={{
											outline: "2px solid",
											outlineColor: "var(--app-focus-ring)",
											outlineOffset: "-2px",
										}}
										onClick={() => handleOpen(candidate.path)}
									>
										<FileTreeFileIcon fileName={candidate.name} size={16} />
										<Box minW="0" flex="1">
											<Text truncate fontSize="sm" fontWeight="medium">
												{candidate.name}
											</Text>
											<Text truncate color="fg.muted" fontFamily="mono" fontSize="xs">
												{candidate.relative_path}
											</Text>
										</Box>
										<FiFileText
											aria-hidden="true"
											size={14}
											style={{ flexShrink: 0 }}
										/>
									</Flex>
								))}
							</Flex>
						</Dialog.Body>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
