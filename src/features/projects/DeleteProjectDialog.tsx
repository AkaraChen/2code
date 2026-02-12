import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useDeleteProject } from "./hooks";

interface DeleteProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	project: { id: string; name: string };
}

export default function DeleteProjectDialog({
	isOpen,
	onClose,
	project,
}: DeleteProjectDialogProps) {
	const deleteProject = useDeleteProject();
	const navigate = useNavigate();

	const handleDelete = async () => {
		await deleteProject.mutateAsync(project.id);
		navigate("/");
		onClose();
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
							<Dialog.Title>{m.deleteProject()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.confirmDeleteProject()}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button colorPalette="red" onClick={handleDelete}>
								{m["delete"]()}
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
