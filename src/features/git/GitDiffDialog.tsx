import {
	CloseButton,
	Dialog,
	HStack,
	Icon,
	Portal,
	Text,
} from "@chakra-ui/react";
import { Suspense } from "react";
import { RiGitBranchLine } from "react-icons/ri";
import GitDiffContent from "./components/GitDiffContent";

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
	branchName?: string;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	profileId,
	branchName,
}: GitDiffDialogProps) {
	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content
						overflow="hidden"
						display="flex"
						flexDirection="column"
					>
						<Dialog.Header py="2" px="4">
							<Dialog.Title fontSize="sm">
								<HStack gap="1.5" alignItems="center">
									<Icon fontSize="md">
										<RiGitBranchLine />
									</Icon>
									<Text>{branchName ?? "main"}</Text>
								</HStack>
							</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>

						<Dialog.Body
							p="0"
							flex="1"
							overflow="hidden"
							display="flex"
						>
							<Suspense fallback={null}>
								<GitDiffContent profileId={profileId} />
							</Suspense>
						</Dialog.Body>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
