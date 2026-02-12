import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useNavigate } from "react-router";
import * as m from "@/paraglide/messages.js";
import { useDeleteProfile } from "./hooks";

interface DeleteProfileDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profile: { id: string; project_id: string };
}

export default function DeleteProfileDialog({
	isOpen,
	onClose,
	profile,
}: DeleteProfileDialogProps) {
	const deleteProfile = useDeleteProfile();
	const navigate = useNavigate();

	const handleDelete = async () => {
		await deleteProfile.mutateAsync({
			id: profile.id,
			projectId: profile.project_id,
		});
		navigate(`/projects/${profile.project_id}`);
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
							<Dialog.Title>{m.deleteProfile()}</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text>{m.confirmDeleteProfile()}</Text>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								colorPalette="red"
								loading={deleteProfile.isPending}
								onClick={handleDelete}
							>
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
