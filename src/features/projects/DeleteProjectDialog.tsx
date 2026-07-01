import { useMatch, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
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
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.deleteProject()}</DialogTitle>
				</DialogHeader>
				<p className="text-sm">{m.confirmDeleteProject()}</p>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{m.cancel()}
					</Button>
					<Button
						variant="destructive"
						disabled={deleteProject.isPending}
						onClick={handleDelete}
					>
						{deleteProject.isPending ? <Spinner /> : null}
						{m.delete()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
