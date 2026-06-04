import {
	Box,
	CloseButton,
	Dialog,
	Flex,
	Portal,
	Text,
} from "@chakra-ui/react";
import { memo, useCallback } from "react";
import { FiFileText } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { FileSearchResult } from "@/generated";
import * as m from "@/paraglide/messages.js";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import { useFileLinkPickerStore } from "./fileLinkPickerStore";

interface CandidateRowProps {
	candidate: FileSearchResult;
	onOpen: (path: string) => void;
}

const CandidateRow = memo(({
	candidate,
	onOpen,
}: CandidateRowProps) => {
	const handleClick = useCallback(() => {
		onOpen(candidate.path);
	}, [candidate.path, onOpen]);

	return (
		<Flex
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
			onClick={handleClick}
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
	);
});

export function TerminalFileLinkPickerDialog() {
	const { isOpen, profileId, candidates, close } = useFileLinkPickerStore(
		useShallow((state) => ({
			isOpen: state.isOpen,
			profileId: state.profileId,
			candidates: state.candidates,
			close: state.close,
		})),
	);
	const openFile = useFileViewerTabsStore((state) => state.openFile);

	const handleOpen = useCallback((path: string) => {
		if (!profileId) return;
		openFile(profileId, path);
		close();
	}, [close, openFile, profileId]);
	const handleOpenChange = useCallback(
		(event: { open: boolean }) => {
			if (!event.open) close();
		},
		[close],
	);

	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={handleOpenChange}
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
									<CandidateRow
										key={candidate.path}
										candidate={candidate}
										onOpen={handleOpen}
									/>
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
