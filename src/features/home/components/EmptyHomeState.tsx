import { Button, Text, VStack } from "@chakra-ui/react";
import { LuPlus } from "react-icons/lu";
import CreateProjectDialog from "@/features/projects/CreateProjectDialog";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";

export function EmptyHomeState() {
	const createDialog = useDialogState();

	return (
		<>
			<VStack gap="4" py="16">
				<Text fontSize="lg" color="fg.muted">
					{m.noProjectsYet()}
				</Text>
				<Button variant="outline" onClick={createDialog.onOpen}>
					<LuPlus />
					{m.createProject()}
				</Button>
			</VStack>
			<CreateProjectDialog
				isOpen={createDialog.isOpen}
				onClose={createDialog.onClose}
			/>
		</>
	);
}
