import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";
import { useMatch, useNavigate } from "react-router";
import type { ProjectWithProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useDeleteProject } from "./hooks";

interface DeleteProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	project: { id: string; name: string };
}

function getReplacementProject(
	projects: ProjectWithProfiles[],
	deletedProjectId: string,
) {
	const deletedIndex = projects.findIndex((item) => item.id === deletedProjectId);
	const remainingProjects = projects.filter((item) => item.id !== deletedProjectId);
	if (remainingProjects.length === 0) return null;

	const replacementIndex = deletedIndex >= 0
		? Math.min(deletedIndex, remainingProjects.length - 1)
		: 0;
	const replacementProject = remainingProjects[replacementIndex];
	const replacementProfile =
		replacementProject.profiles.find((profile) => profile.is_default)
		?? replacementProject.profiles[0];

	if (!replacementProfile) return null;
	return { project: replacementProject, profile: replacementProfile };
}

export default function DeleteProjectDialog({
	isOpen,
	onClose,
	project,
}: DeleteProjectDialogProps) {
	const navigate = useNavigate();
	const projectMatch = useMatch("/projects/:projectId/profiles/:profileId");
	const deleteProject = useDeleteProject({
		onSuccess: (deletedProjectId, projectsBeforeDelete) => {
			if (projectMatch?.params.projectId !== deletedProjectId) {
				onClose();
				return;
			}
			const replacement = getReplacementProject(
				projectsBeforeDelete,
				deletedProjectId,
			);
			if (replacement) {
				navigate(
					`/projects/${replacement.project.id}/profiles/${replacement.profile.id}`,
					{ replace: true },
				);
			} else {
				navigate("/", { replace: true });
			}
			onClose();
		},
	});

	const handleDelete = () => {
		deleteProject.mutate(project.id);
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
							<Button
								colorPalette="red"
								loading={deleteProject.isPending}
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
