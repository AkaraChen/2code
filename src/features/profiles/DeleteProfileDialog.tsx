import {
	Alert,
	Button,
	CloseButton,
	Dialog,
	HStack,
	Portal,
	Spinner,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useMatch, useNavigate } from "react-router";
import type { GitDiffStats, Profile } from "@/generated";
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

export function getFallbackProfile(
	profiles: readonly Profile[] | undefined,
	deletedProfileId: string,
) {
	let firstFallback: Profile | undefined;
	for (const profile of profiles ?? []) {
		if (profile.id === deletedProfileId) {
			continue;
		}
		if (profile.is_default) {
			return profile;
		}
		firstFallback ??= profile;
	}
	return firstFallback;
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
		const fallbackProfile = getFallbackProfile(
			project?.profiles,
			profile.id,
		);

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
							<Stack gap="3">
								<Text>{m.confirmDeleteProfile()}</Text>
								{deleteCheck.isChecking && (
									<HStack gap="2" color="fg.muted" fontSize="sm">
										<Spinner size="xs" />
										<Text>{m.deleteProfileCheckingGitStatus()}</Text>
									</HStack>
								)}
								{!deleteCheck.isChecking && deleteCheck.hasRisk && (
									<Alert.Root status="warning" variant="surface">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Title>
												{m.deleteProfileGitWarningTitle()}
											</Alert.Title>
											<Alert.Description>
												{warningDescription}
											</Alert.Description>
										</Alert.Content>
									</Alert.Root>
								)}
								{!deleteCheck.isChecking && deleteCheck.isError && (
									<Alert.Root status="warning" variant="subtle">
										<Alert.Indicator />
										<Alert.Content>
											<Alert.Title>
												{m.deleteProfileGitCheckFailedTitle()}
											</Alert.Title>
											<Alert.Description>
												{m.deleteProfileGitCheckFailedDescription()}
											</Alert.Description>
										</Alert.Content>
									</Alert.Root>
								)}
							</Stack>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button
								colorPalette="red"
								disabled={deleteCheck.isFetching}
								loading={deleteProfile.isPending}
								onClick={handleDelete}
							>
								{deleteCheck.hasRisk
									? m.deleteProfileAnyway()
									: m.delete()}
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
