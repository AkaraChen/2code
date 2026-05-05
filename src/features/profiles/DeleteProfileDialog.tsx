import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useMatch, useNavigate } from "react-router";
import { useProjects } from "@/features/projects/hooks";
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
	const { data: projects } = useProjects();
	const profileMatch = useMatch("/projects/:projectId/profiles/:profileId");

	const handleDelete = async () => {
		const isDeletingActiveProfile =
			profileMatch?.params.profileId === profile.id;
		const project = projects.find((item) => item.id === profile.project_id);
		const fallbackProfile =
			project?.profiles.find(
				(item) => item.id !== profile.id && item.is_default,
			) ?? project?.profiles.find((item) => item.id !== profile.id);

		await deleteProfile.mutateAsync({
			id: profile.id,
			projectId: profile.project_id,
		});
		if (isDeletingActiveProfile) {
			if (fallbackProfile) {
				navigate(
					`/projects/${profile.project_id}/profiles/${fallbackProfile.id}`,
					{ replace: true },
				);
			} else {
				navigate("/", { replace: true });
			}
		}
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
								{m.delete()}
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
