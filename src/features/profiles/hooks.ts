import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTerminalStore } from "@/features/terminal/store";
import { createProfile, deleteProfile } from "@/generated";
import type { ProjectWithProfiles } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useCreateProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectId,
			branchName,
		}: {
			projectId: string;
			branchName: string;
		}) => createProfile({ projectId, branchName }),
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
		onSuccess: (_data, { id }) => {
			useTerminalStore.getState().removeProfile(id);
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((project) => ({
						...project,
						profiles: project.profiles.filter((profile) => profile.id !== id),
					})),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
