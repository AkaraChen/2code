import { useMatch, useNavigate } from "react-router";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { GitDiffStats } from "@/generated";
import { useProjects } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { useDeleteProfile, useProfileDeleteCheck } from "./hooks";

interface DeleteProfileDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profile: { id: string; project_id: string };
}

function hasDiffStats(stats: GitDiffStats | null) {
	return (
		(stats?.files_changed ?? 0) > 0 ||
		(stats?.insertions ?? 0) > 0 ||
		(stats?.deletions ?? 0) > 0
	);
}

export default function DeleteProfileDialog({
	isOpen,
	onClose,
	profile,
}: DeleteProfileDialogProps) {
	const deleteProfile = useDeleteProfile();
	const deleteCheck = useProfileDeleteCheck(profile.id, isOpen);
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

	const warningDescription = [
		hasDiffStats(deleteCheck.workingTreeDiff)
			? m.deleteProfileLocalChangesWarning({
					files: deleteCheck.workingTreeDiff?.files_changed ?? 0,
					insertions: deleteCheck.workingTreeDiff?.insertions ?? 0,
					deletions: deleteCheck.workingTreeDiff?.deletions ?? 0,
				})
			: null,
		deleteCheck.hasUnpushedCommits
			? m.deleteProfileUnpushedCommitsWarning({
					count: deleteCheck.unpushedCommitCount,
					files: deleteCheck.unpushedCommitDiff?.files_changed ?? 0,
					insertions: deleteCheck.unpushedCommitDiff?.insertions ?? 0,
					deletions: deleteCheck.unpushedCommitDiff?.deletions ?? 0,
				})
			: null,
		hasDiffStats(deleteCheck.totalDiff)
			? m.deleteProfileTotalDiffWarning({
					files: deleteCheck.totalDiff?.files_changed ?? 0,
					insertions: deleteCheck.totalDiff?.insertions ?? 0,
					deletions: deleteCheck.totalDiff?.deletions ?? 0,
				})
			: null,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.deleteProfile()}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<p className="text-sm">{m.confirmDeleteProfile()}</p>
					{deleteCheck.isChecking ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Spinner />
							<span>{m.deleteProfileCheckingGitStatus()}</span>
						</div>
					) : null}
					{!deleteCheck.isChecking && deleteCheck.hasRisk ? (
						<Alert>
							<AlertTitle>{m.deleteProfileGitWarningTitle()}</AlertTitle>
							<AlertDescription>{warningDescription}</AlertDescription>
						</Alert>
					) : null}
					{!deleteCheck.isChecking && deleteCheck.isError ? (
						<Alert>
							<AlertTitle>
								{m.deleteProfileGitCheckFailedTitle()}
							</AlertTitle>
							<AlertDescription>
								{m.deleteProfileGitCheckFailedDescription()}
							</AlertDescription>
						</Alert>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{m.cancel()}
					</Button>
					<Button
						variant="destructive"
						disabled={deleteCheck.isFetching || deleteProfile.isPending}
						onClick={handleDelete}
					>
						{deleteProfile.isPending ? <Spinner /> : null}
						{deleteCheck.hasRisk
							? m.deleteProfileAnyway()
							: m.delete()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
