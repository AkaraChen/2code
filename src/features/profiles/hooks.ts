import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorktreeSettingsStore } from "@/features/settings/stores/worktreeSettingsStore";
import { useTerminalStore } from "@/features/terminal/store";
import {
	createProfile,
	deleteProfile,
	getProfileDeleteCheck,
	updateProfileNotes,
	type GitDiffStats,
} from "@/generated";
import type { ProjectWithProfiles } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

function hasDiffStats(stats: GitDiffStats | null) {
	return (
		(stats?.files_changed ?? 0) > 0 ||
		(stats?.insertions ?? 0) > 0 ||
		(stats?.deletions ?? 0) > 0
	);
}

export function useCreateProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectId,
			branchName,
		}: {
			projectId: string;
			branchName: string;
		}) => {
			const defaultWorktreeDir =
				useWorktreeSettingsStore.getState().defaultWorktreeDir;
			return createProfile({
				projectId,
				branchName,
				defaultWorktreeDir: defaultWorktreeDir || null,
			});
		},
		onSuccess: (profile) => {
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((project) => {
						if (project.id !== profile.project_id) return project;
						const hasProfile = project.profiles.some(
							(item) => item.id === profile.id,
						);
						return {
							...project,
							profiles: hasProfile
								? project.profiles.map((item) =>
										item.id === profile.id ? profile : item,
									)
								: [...project.profiles, profile],
						};
					}),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useDeleteProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id }: { id: string; projectId: string }) =>
			deleteProfile({ id }),
		onSuccess: (_data, { id, projectId }) => {
			useTerminalStore.getState().removeProfile(id);
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((project) => {
						if (project.id !== projectId) return project;
						const profiles = project.profiles.filter(
							(profile) => profile.id !== id,
						);
						if (profiles.length === project.profiles.length) {
							return project;
						}
						return { ...project, profiles };
					}),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useProfileDeleteCheck(profileId: string, enabled: boolean) {
	const check = useQuery({
		queryKey: queryKeys.profile.deleteCheck(profileId),
		queryFn: () => getProfileDeleteCheck({ id: profileId }),
		enabled: !!profileId && enabled,
		staleTime: 0,
		refetchOnMount: "always",
	});

	const workingTreeDiff = check.data?.working_tree_diff ?? null;
	const unpushedCommitCount = check.data?.unpushed_commit_count ?? 0;
	const unpushedCommitDiff = check.data?.unpushed_commit_diff ?? null;
	const totalDiff = check.data?.total_diff ?? null;
	const hasLocalChanges = hasDiffStats(workingTreeDiff);
	const hasUnpushedCommits = unpushedCommitCount > 0;

	return {
		workingTreeDiff,
		unpushedCommitCount,
		unpushedCommitDiff,
		totalDiff,
		hasLocalChanges,
		hasUnpushedCommits,
		hasRisk: hasLocalChanges || hasUnpushedCommits,
		isChecking: check.isLoading,
		isFetching: check.isFetching,
		isError: check.isError,
	};
}

export function useUpdateProfileNotes() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes: string }) =>
			updateProfileNotes({ id, notes }),
		onSuccess: (profile) => {
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((project) => {
						if (project.id !== profile.project_id) return project;
						let changed = false;
						const profiles = project.profiles.map((p) => {
							if (p.id !== profile.id) return p;
							changed = true;
							return profile;
						});
						return changed ? { ...project, profiles } : project;
					}),
			);
		},
	});
}
