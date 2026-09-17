import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { useWorktreeSettingsStore } from "@/features/settings/stores/worktreeSettingsStore";
import { useTerminalStore } from "@/features/terminal/store";
import {
	createProfile,
	deleteProfile,
	getProfileDeleteCheck,
	listProjects,
	updateProfileNotes,
	type GitDiffStats,
	type Profile,
	type ProjectWithProfiles,
} from "@/generated";
import { getErrorMessage } from "@/shared/lib/errors";
import { queryKeys } from "@/shared/lib/queryKeys";

function hasDiffStats(stats: GitDiffStats | null) {
	return (
		(stats?.files_changed ?? 0) > 0 ||
		(stats?.insertions ?? 0) > 0 ||
		(stats?.deletions ?? 0) > 0
	);
}

export function liveProfileMatchingCreate(
	projects: ProjectWithProfiles[] | undefined,
	created: Pick<
		Profile,
		"id" | "project_id" | "worktree_path" | "branch_name"
	>,
): Profile | undefined {
	const project = projects?.find((item) => item.id === created.project_id);
	if (!project) return undefined;
	return (
		project.profiles.find((profile) => profile.id === created.id) ??
		project.profiles.find(
			(profile) => profile.worktree_path === created.worktree_path,
		) ??
		project.profiles.find(
			(profile) => profile.branch_name === created.branch_name,
		)
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
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.projects.all,
			});
			await queryClient.fetchQuery({
				queryKey: queryKeys.projects.all,
				queryFn: listProjects,
			});
		},
		onError: (error) => {
			toast.error(getErrorMessage(error));
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
	const latestRevisionByProfileIdRef = useRef(new Map<string, number>());
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes: string }) =>
			updateProfileNotes({ id, notes }),
		onMutate: ({ id }) => {
			const revision = (latestRevisionByProfileIdRef.current.get(id) ?? 0) + 1;
			latestRevisionByProfileIdRef.current.set(id, revision);
			return { revision };
		},
		onSuccess: (profile, { id, notes }, context) => {
			if (
				!context ||
				latestRevisionByProfileIdRef.current.get(id) !== context.revision
			) {
				return;
			}
			if (profile.notes !== notes) {
				return;
			}
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((project) => {
						if (project.id !== profile.project_id) return project;
						let changed = false;
						const profiles = project.profiles.map((existing) => {
							if (existing.id !== profile.id && existing.id !== id) {
								return existing;
							}
							changed = true;
							return {
								...existing,
								notes: profile.notes,
								worktree_path:
									profile.worktree_path || existing.worktree_path,
								branch_name:
									profile.branch_name || existing.branch_name,
								is_default: existing.is_default,
							};
						});
						return changed ? { ...project, profiles } : project;
					}),
			);
		},
	});
}
